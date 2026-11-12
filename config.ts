// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// opencode.json / opencode.jsonc I/O and server-state reads. Host-agnostic:
// the live SDK calls that apply an entry to a running OpenCode instance live in
// the runtime adapters (adapters/v1.ts, adapters/v2.ts).
//
// The Datadog entry can live in either config shape, and both runtimes must
// see the same state:
//   mcp.<name>          — V1 shape. OpenCode 2.x also reads it, so new entries
//                         are written here and a project works on either runtime.
//   mcp.servers.<name>  — V2-native shape. Read, and edited in place, so a
//                         user's hand-written V2 entry is never duplicated.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ParseError, applyEdits, modify, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';

import { isKnownDomain } from '#shared/site';
import { type ConnectionBuilder, DATADOG_HEADERS, MCP_PATH, TOOLSETS_HEADER } from '#shared/url';

export type McpEntry = {
  type: 'remote' | 'local';
  url: string;
  oauth?: Record<string, unknown> | false;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
};

export type OpenCodeConfig = { mcp?: Record<string, unknown> & { servers?: Record<string, unknown> } };

// JSON path of the entry inside the config file.
export type EntryPath = readonly string[];

export const defaultEntryPath = (mcpName: string): EntryPath => ['mcp', mcpName];

const asEntry = (value: unknown): McpEntry | undefined =>
  value !== null && typeof value === 'object' && typeof (value as McpEntry).url === 'string'
    ? (value as McpEntry)
    : undefined;

// V1 shape first: it's what the tools write, so if both shapes are present the
// one the plugin manages wins.
const findEntry = (config: OpenCodeConfig, mcpName: string): { entry: McpEntry; path: EntryPath } | undefined => {
  const v1 = asEntry(config.mcp?.[mcpName]);
  if (v1) return { entry: v1, path: defaultEntryPath(mcpName) };
  const servers = config.mcp?.servers;
  const v2 = servers !== null && typeof servers === 'object' ? asEntry(servers[mcpName]) : undefined;
  if (v2) return { entry: v2, path: ['mcp', 'servers', mcpName] };
  return undefined;
};

// HTTP header names are case-insensitive, and a hand-edited entry may use any case.
const sameHeader = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const isDatadogHeader = (name: string): boolean => DATADOG_HEADERS.some((h) => sameHeader(h, name));

const stringHeaders = (headers: unknown): [string, string][] =>
  headers !== null && typeof headers === 'object'
    ? Object.entries(headers).filter((pair): pair is [string, string] => typeof pair[1] === 'string')
    : [];

// The plugin-owned `X-Datadog-MCP-*` headers of `headers`.
export const datadogHeaders = (headers: McpEntry['headers']): Record<string, string> =>
  Object.fromEntries(stringHeaders(headers).filter(([name]) => isDatadogHeader(name)));

// Replaces the plugin-owned headers in `base` with `ours`, keeping every other
// header (API keys, `{env:…}` placeholders) as it was.
export const mergeDatadogHeaders = (
  base: McpEntry['headers'],
  ours: Record<string, string>,
): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(base ?? {}).filter(([name]) => !isDatadogHeader(name))),
  ...ours,
});

// True when `headers` carries exactly the plugin-owned headers in `ours`.
export const hasDatadogHeaders = (headers: McpEntry['headers'], ours: Record<string, string>): boolean => {
  const normalize = (h: Record<string, string>) =>
    JSON.stringify(
      Object.entries(h)
        .map(([name, value]) => [name.toLowerCase(), value])
        .sort(),
    );
  return normalize(datadogHeaders(headers)) === normalize(datadogHeaders(ours));
};

// Endpoint path before MCPS-394 (plugin releases up to opencode v0.7.7, and
// the README's key-auth example until then). Hand-written entries have it
// without any query params.
const UNSTABLE_MCP_PATH = '/api/unstable/mcp-server/mcp';
// Query params that plugin versions before the header switch put in the URL.
// `plugin_version` changed with every release, so the URL wasn't stable.
const LEGACY_QUERY_PARAMS = ['toolsets', 'referrer_ide', 'plugin_version'] as const;

// True for a URL that an earlier plugin version, or its README, produced: the
// unstable path in any form, or the current path with legacy query params.
// Any other path is left alone, since it may be a deliberate proxy or test
// endpoint.
const isLegacy = (url: URL): boolean => {
  const path = url.pathname.replace(/\/+$/, '');
  if (path === UNSTABLE_MCP_PATH) return true;
  return path === MCP_PATH && LEGACY_QUERY_PARAMS.some((name) => url.searchParams.has(name));
};

export const isLegacyUrl = (url: string): boolean => {
  try {
    return isLegacy(new URL(url));
  } catch {
    return false;
  }
};

// The query part's name, decoded as URLSearchParams would decode it.
const queryPartName = (part: string): string => {
  const name = part.split('=', 1)[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

// `url` with only its plugin-owned legacy parts removed: the `toolsets`,
// `referrer_ide` and `plugin_version` query params, which the X-Datadog-MCP-*
// headers now carry, and the unstable path, which becomes /v1/mcp. Migration
// and `ddtoolsets` both write this, on any URL, so a proxy URL that still has
// `?toolsets=` doesn't send a second, possibly different, toolsets value.
//
// Design rule: these three names are plugin-owned on every host, not only on
// Datadog's legacy URLs. A proxy that needs its own param by one of these
// names loses it on the next `ddtoolsets`; the README says the plugin owns
// them. Don't narrow this back to legacy URLs, or a proxy's leftover
// `?toolsets=` is sent alongside the header again.
//
// It edits the URL text rather than parsing and serializing it, so everything
// else stays byte for byte. Serializing re-encodes a URL (`{env:FOO}` becomes
// `%7Benv%3AFOO%7D`, which OpenCode no longer substitutes, and `a,b` becomes
// `a%2Cb`), and OpenCode may tie stored OAuth tokens to the exact URL.
export const stableUrl = (url: string): string => {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);

  let query = queryAt === -1 ? undefined : beforeHash.slice(queryAt + 1);
  if (query !== undefined) {
    const parts = query.split('&');
    const kept = parts.filter((part) => !(LEGACY_QUERY_PARAMS as readonly string[]).includes(queryPartName(part)));
    if (kept.length !== parts.length) query = kept.join('&') || undefined;
  }

  // Only the exact unstable path after the host, as `isLegacyUrl` matches it.
  const stableBase = base.replace(
    /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*)\/api\/unstable\/mcp-server\/mcp\/*$/,
    `$1${MCP_PATH}`,
  );
  return stableBase + (query === undefined ? '' : `?${query}`) + hash;
};

// `url` moved to `domain` by `ddconfig change-site`, with its legacy parts
// removed and any other query params kept. A known Datadog domain serves only
// https://<domain>/v1/mcp, so the scheme and path are reset to that. Any other
// domain (a proxy or test server) keeps the scheme and path. The host is
// replaced, including the old port, which belonged to the old host. Changing
// the host means serializing the URL, so it comes back normalized: an
// `{env:…}` placeholder in the path or query is percent-encoded.
export const movedUrl = (url: string, domain: string): string => {
  const moved = new URL(stableUrl(url));
  const target = new URL(`https://${domain}`);
  if (isKnownDomain(domain)) {
    moved.protocol = 'https:';
    moved.pathname = MCP_PATH;
  }
  moved.hostname = target.hostname;
  moved.port = target.port;
  return moved.toString();
};

export type ParsedEntry = { domain: string; toolsets: string };

// The X-Datadog-MCP-Toolsets header's value, if the entry has one.
export const headerToolsets = (headers: McpEntry['headers']): string | undefined =>
  stringHeaders(headers).find(([name]) => sameHeader(name, TOOLSETS_HEADER))?.[1];

// Domain comes from the URL. Toolsets come from the X-Datadog-MCP-Toolsets
// header, falling back to the `?toolsets=` query param that plugin versions
// before the header switch wrote. The next write moves them into the header.
//
// On a legacy URL that has the param, the param wins over the header. This
// version never writes the param, so when both are present the param is the
// newer value, written by an older plugin version sharing the config (for
// example a teammate on 0.7.x running `ddtoolsets` on a committed file).
export const parseEntry = (entry: McpEntry): ParsedEntry | undefined => {
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return undefined;
  }
  const domain = url.hostname + (url.port ? `:${url.port}` : '');
  if (!domain) return undefined;
  const param = url.searchParams.get('toolsets');
  const header = headerToolsets(entry.headers);
  const toolsets = param !== null && (isLegacy(url) || header === undefined) ? param : (header ?? '');
  return { domain, toolsets };
};

// The `url` and `headers` of an entry connecting to `domain` with `toolsets`.
// The URL is the bare endpoint, which only `ddsetup` writes as is; the other
// tools and migration keep the existing URL (see `stableUrl`, `movedUrl`) and
// take only the headers. An empty toolset list omits the toolsets header, so
// the server applies its defaults. Headers in `existing` that the plugin
// doesn't own are kept.
export const connectionFields = (
  connection: ConnectionBuilder,
  domain: string,
  toolsets: string,
  existing?: McpEntry['headers'],
): { url: string; headers: Record<string, string> } => {
  const { url, headers } = connection.build(domain, toolsets);
  const ours = Object.fromEntries(Object.entries(headers).filter(([name, value]) => name !== TOOLSETS_HEADER || value));
  return { url, headers: mergeDatadogHeaders(existing, ours) };
};

// OpenCode substitutes `{env:VAR}` when it loads a config file, but live
// registration takes a config as-is, so the adapters do the same substitution.
// An unset variable becomes an empty string, as in OpenCode. This applies to
// the URL as well as headers: the tools keep a URL's placeholders in the file,
// so the live URL must be resolved separately.
//
// `{file:path}` isn't resolved: OpenCode resolves its path relative to the
// config file that holds it, which this helper doesn't know. Such a value is
// registered literally until OpenCode next loads its config. That affects only
// live registration: V1's `client.mcp.add`, V2's `set` branch for an entry the
// host hasn't loaded yet, and the URL in V2's `update` branch.
export const resolveEnv = (value: string): string =>
  value.replace(/\{env:([^}]+)\}/g, (_, variable: string) => process.env[variable] ?? '');

export const substituteEnv = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, resolveEnv(value)]));

// Project config files the tools read, highest precedence first. This mirrors
// how OpenCode merges project config (later merges win): `.opencode/` config
// overrides the project root, and within a folder `.jsonc` overrides `.json`.
// OpenCode also merges config from parent directories up to the worktree root
// and from global config; the plugin only manages these project-level files.
export const CONFIG_FILES = [
  join('.opencode', 'opencode.jsonc'),
  join('.opencode', 'opencode.json'),
  'opencode.jsonc',
  'opencode.json',
] as const;

// Created when no project config file exists yet.
const NEW_CONFIG_FILE = 'opencode.json';

export type ReadResult =
  | { status: 'missing' }
  | { status: 'malformed'; file: string; reason: string }
  | { status: 'parsed'; file: string; text: string; config: OpenCodeConfig };

const readConfigFile = async (dir: string, file: string): Promise<ReadResult> => {
  let text: string;
  try {
    text = await readFile(join(dir, file), 'utf8');
  } catch {
    return { status: 'missing' };
  }

  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true }) as unknown;

  if (errors.length > 0) {
    const first = errors[0];
    const reason = `${printParseErrorCode(first.error)} at offset ${String(first.offset)}`;
    return { status: 'malformed', file, reason };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'malformed', file, reason: 'top-level value is not an object' };
  }
  return { status: 'parsed', file, text, config: parsed as OpenCodeConfig };
};

// Persists `entry` at `path` (see `findEntry`) in the file `read` came from,
// either as a surgical edit on an existing file (preserving comments, trailing
// commas, and sibling keys) or by creating a fresh opencode.json. Callers pass
// the existing `ReadResult` so we don't re-read the file — and so a 'malformed'
// result is an explicit branch that tools already refused to reach.
export const persistEntry = async (
  dir: string,
  read: Exclude<ReadResult, { status: 'malformed' }>,
  path: EntryPath,
  entry: McpEntry,
): Promise<void> => {
  const [sourceText, targetFile] = read.status === 'parsed' ? [read.text, read.file] : ['{}', NEW_CONFIG_FILE];
  const edits = modify(sourceText, [...path], entry, { formattingOptions: { tabSize: 2, insertSpaces: true } });
  const output = applyEdits(sourceText, edits);
  // Creating fresh — add trailing newline; editing — trust existing formatting.
  const finalText = read.status === 'parsed' ? output : `${output}\n`;
  await writeFile(join(dir, targetFile), finalText);
};

export type ServerState =
  | {
      kind: 'not-setup';
      // File `ddsetup` writes to: the file holding the effective entry, else
      // the highest-precedence existing file, else a new opencode.json.
      read: Exclude<ReadResult, { status: 'malformed' }>;
      // Set when the effective entry exists but its URL is unusable, so
      // `ddsetup` repairs its `url` in place instead of adding a second entry.
      path?: EntryPath;
      entry?: McpEntry;
    }
  | { kind: 'malformed-config'; file: string; reason: string }
  | {
      kind: 'configured';
      read: Extract<ReadResult, { status: 'parsed' }>;
      entry: McpEntry;
      path: EntryPath;
      parsed: ParsedEntry;
    };

// Resolves the Datadog entry across CONFIG_FILES. The first file that has an
// entry wins, as it does in OpenCode, and edits go back to that file. If that
// entry's URL is unusable, the result is not-setup for that file. It never
// falls back to a lower-precedence entry OpenCode isn't using. Every candidate
// is read, and any malformed one blocks the tools: OpenCode can't load it
// either, and its contents could override the entry found elsewhere.
export const loadServerState = async (dir: string, mcpName: string): Promise<ServerState> => {
  let firstExisting: Extract<ReadResult, { status: 'parsed' }> | undefined;
  let effective: { read: Extract<ReadResult, { status: 'parsed' }>; entry: McpEntry; path: EntryPath } | undefined;

  for (const file of CONFIG_FILES) {
    const read = await readConfigFile(dir, file);
    if (read.status === 'malformed') return { kind: 'malformed-config', file: read.file, reason: read.reason };
    if (read.status === 'missing') continue;
    firstExisting ??= read;
    if (!effective) {
      const found = findEntry(read.config, mcpName);
      if (found) effective = { read, ...found };
    }
  }

  if (effective) {
    const { read, entry, path } = effective;
    const parsed = parseEntry(entry);
    if (parsed) return { kind: 'configured', read, entry, path, parsed };
    return { kind: 'not-setup', read, path, entry };
  }
  return { kind: 'not-setup', read: firstExisting ?? { status: 'missing' } };
};

export const malformedConfigMessage = (state: Extract<ServerState, { kind: 'malformed-config' }>): string =>
  [
    `Your ${state.file} could not be parsed: ${state.reason}.`,
    'Fix the syntax error manually before using Datadog tools. The plugin will not overwrite a malformed config.',
  ].join('\n');
