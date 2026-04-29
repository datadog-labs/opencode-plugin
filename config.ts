// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// opencode.json / opencode.jsonc I/O, server-state reads, and the live SDK
// counterparts (`addMcpServer`, `reconnectMcpServer`). Grouped into one module
// because they share the `McpEntry` shape and the `oauth: false` preservation
// rule needs to live in one place.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ParseError, applyEdits, modify, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import type { PluginInput } from '@opencode-ai/plugin';

import { type ParsedUrl, parseMcpUrl } from './url.js';

export type McpEntry = {
  type: 'remote' | 'local';
  url: string;
  oauth?: Record<string, unknown> | false;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
};

export type OpenCodeConfig = { mcp?: Record<string, McpEntry> };

export type McpClient = PluginInput['client'];

const CONFIG_FILES = ['opencode.json', 'opencode.jsonc'] as const;

export type ReadResult =
  | { status: 'missing' }
  | { status: 'malformed'; file: string; reason: string }
  | { status: 'parsed'; file: string; text: string; config: OpenCodeConfig };

const findConfigFile = async (dir: string): Promise<string | undefined> => {
  for (const file of CONFIG_FILES) {
    try {
      await readFile(join(dir, file), 'utf8');
      return file;
    } catch {
      // try next
    }
  }
  return undefined;
};

export const readConfig = async (dir: string): Promise<ReadResult> => {
  const file = await findConfigFile(dir);
  if (!file) return { status: 'missing' };

  const text = await readFile(join(dir, file), 'utf8');
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

// Persists `entry` at `config.mcp[mcpName]`, either as a surgical edit on an
// existing file (preserving comments, trailing commas, and sibling keys) or by
// creating a fresh opencode.json. Callers pass the existing `ReadResult` so we
// don't re-read the file — and so a 'malformed' result is an explicit branch
// that tools already refused to reach.
export const persistEntry = async (
  dir: string,
  read: Exclude<ReadResult, { status: 'malformed' }>,
  mcpName: string,
  entry: McpEntry,
): Promise<void> => {
  const [sourceText, targetFile] = read.status === 'parsed' ? [read.text, read.file] : ['{}', CONFIG_FILES[0]];
  const edits = modify(sourceText, ['mcp', mcpName], entry, { formattingOptions: { tabSize: 2, insertSpaces: true } });
  const output = applyEdits(sourceText, edits);
  // Creating fresh — add trailing newline; editing — trust existing formatting.
  const finalText = read.status === 'parsed' ? output : `${output}\n`;
  await writeFile(join(dir, targetFile), finalText);
};

export type ServerState =
  | { kind: 'not-setup'; read: Exclude<ReadResult, { status: 'malformed' }> }
  | { kind: 'malformed-config'; file: string; reason: string }
  | { kind: 'configured'; read: Extract<ReadResult, { status: 'parsed' }>; entry: McpEntry; parsed: ParsedUrl };

export const loadServerState = async (dir: string, mcpName: string): Promise<ServerState> => {
  const read = await readConfig(dir);
  if (read.status === 'malformed') return { kind: 'malformed-config', file: read.file, reason: read.reason };
  if (read.status === 'missing') return { kind: 'not-setup', read };

  const entry = read.config.mcp?.[mcpName];
  if (!entry?.url) return { kind: 'not-setup', read };
  const parsed = parseMcpUrl(entry.url);
  if (!parsed?.domain) return { kind: 'not-setup', read };
  return { kind: 'configured', read, entry, parsed };
};

export const malformedConfigMessage = (state: Extract<ServerState, { kind: 'malformed-config' }>): string =>
  [
    `Your ${state.file} could not be parsed: ${state.reason}.`,
    'Fix the syntax error manually before using Datadog tools. The plugin will not overwrite a malformed config.',
  ].join('\n');

// Preserve the caller's oauth choice when re-registering the server live:
//   false      → disable OAuth (key-auth flow)
//   object/{}  → enable OAuth with those options
//   undefined  → default (enable OAuth auto-detection with empty options)
const normalizeOauth = (oauth: McpEntry['oauth']): McpEntry['oauth'] => (oauth === false ? false : (oauth ?? {}));

export const addMcpServer = async (
  client: McpClient,
  mcpName: string,
  url: string,
  oauth: McpEntry['oauth'],
): Promise<void> => {
  await client.mcp.add({ body: { name: mcpName, config: { type: 'remote', url, oauth: normalizeOauth(oauth) } } });
};

export const reconnectMcpServer = async (
  client: McpClient,
  mcpName: string,
  url: string,
  oauth: McpEntry['oauth'],
): Promise<void> => {
  await client.mcp.disconnect({ path: { name: mcpName } });
  await addMcpServer(client, mcpName, url, oauth);
};
