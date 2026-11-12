// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// OpenCode 2.x adapter. V2 ignores `server()` and calls the default export's
// `setup(ctx)` once per plugin instance, so everything is registered here.
//
// `@opencode/plugin` is imported for types only. The same entry file is loaded
// by V1, where that package isn't installed, and `Plugin.define` is an identity
// function, so nothing from it is needed at runtime.

import type { Plugin } from '@opencode/plugin';

import { toJsonSchema } from '../core/args.js';
import { terminalAuthLines } from '../core/auth.js';
import { TOOLS, runTool } from '../core/index.js';
import { migrateLegacyEntry } from '../core/migrate.js';
import type { CoreDeps, HostEnv } from '../core/types.js';
import {
  type McpEntry,
  datadogHeaders,
  hasDatadogHeaders,
  mergeDatadogHeaders,
  resolveEnv,
  substituteEnv,
} from '../config.js';

type McpEditor = Parameters<Parameters<Plugin.Context['mcp']['transform']>[0]>[0];
type RemoteServerConfig = Extract<NonNullable<ReturnType<McpEditor['get']>>, { type: 'remote' }>;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

// Settings of a file entry that the tools don't own but that change how the
// host runs the server, in V2's shape. The file entry may be in either shape:
// V2's `mcp.servers` entries already use these names, and a V1 `mcp` entry's
// `enabled: false` means V2's `disabled: true`. V1's numeric `timeout` has no
// single V2 equivalent (V2 splits it into startup, catalog and execution), so
// it's left for the next start to load. Only used when registering an entry
// the host hasn't resolved; otherwise the host's resolved settings are kept.
export const v2Settings = (entry: McpEntry): Partial<RemoteServerConfig> => {
  const raw = entry as Record<string, unknown>;
  const disabled = typeof raw.disabled === 'boolean' ? raw.disabled : raw.enabled === false ? true : undefined;
  return {
    ...(disabled !== undefined && { disabled }),
    ...(typeof raw.codemode === 'boolean' && { codemode: raw.codemode }),
    ...(isObject(raw.timeout) && { timeout: raw.timeout as RemoteServerConfig['timeout'] }),
    ...(typeof raw.protocol === 'string' && { protocol: raw.protocol as RemoteServerConfig['protocol'] }),
    ...(typeof raw.pool === 'boolean' && { pool: raw.pool }),
  };
};

export const authInstructionsV2 = (mcpName: string, directory: string): readonly string[] => [
  `Tell the user to run /mcp in OpenCode and sign in to the "${mcpName}" server,`,
  'or to run this command in a separate terminal.',
  ...terminalAuthLines(mcpName, directory),
];

export const setupV2 = async (ctx: Plugin.Context, deps: CoreDeps): Promise<void> => {
  // File only, so the transform below stays a no-op until a tool writes a
  // change (see core/migrate.ts).
  await migrateLegacyEntry(deps, ctx.location.directory);

  // Entry a tool wrote to the config file in this session that the host may not
  // have loaded yet. `undefined` means the transform is a no-op and the config
  // files are the only source.
  let pending: McpEntry | undefined;

  // Transforms replay onto a freshly resolved config on every rebuild, so this
  // edits the host's resolved entry instead of replacing it. Everything the
  // tools don't own (other headers with `{env:…}` already substituted,
  // `disabled`, timeouts, `protocol`, `codemode`, ...) stays exactly as the
  // host resolved it. The tools only ever change `url` and the
  // `X-Datadog-MCP-*` headers.
  const applyPending = (editor: McpEditor) => {
    if (pending === undefined) return;
    const { headers, oauth } = pending;
    // The file keeps any `{env:…}` in the URL; the host compares and connects
    // with it resolved, so the live URL must be resolved too.
    const url = resolveEnv(pending.url);
    const ours = datadogHeaders(headers);
    const current = editor.get(deps.mcpName);
    if (!current) {
      // The host has no resolved entry: a fresh ddsetup, or a file entry the
      // host hasn't loaded, which ddconfig or ddtoolsets can also reach.
      // Register what was written to the file, with its URL and headers (with
      // `{env:…}` resolved, as the host would), its `oauth` value and its
      // runtime settings (see `v2Settings`), so the live server matches the
      // one the next start loads. `oauth` is passed as written: the plugin
      // writes only `{}` or `false`, but a hand-written V1 entry's camelCase
      // options (`clientId`) aren't translated to V2's snake_case
      // (`client_id`) here; the next start loads them correctly.
      editor.set(deps.mcpName, {
        type: 'remote',
        url,
        ...(headers && { headers: substituteEnv(headers) }),
        ...(oauth !== undefined && { oauth }),
        ...v2Settings(pending),
      });
      return;
    }
    if (current.type !== 'remote') return; // not an entry this plugin manages
    if (current.url === url && hasDatadogHeaders(current.headers, ours)) {
      // The host has loaded the change from the config file, so stand down. A
      // later hand edit to the file then wins, as it would without the plugin.
      pending = undefined;
      return;
    }
    editor.update(deps.mcpName, (config) => {
      if (config.type !== 'remote') return;
      config.url = url;
      config.headers = mergeDatadogHeaders(config.headers, ours);
    });
  };
  await ctx.mcp.transform(applyPending);

  const apply = async (entry: McpEntry) => {
    pending = entry;
    try {
      await ctx.mcp.reload();
    } catch (error) {
      // The tool reports "restart OpenCode". Clear the override rather than
      // restoring an earlier pending entry: the config file already holds this
      // newer change, so any earlier entry is stale, and an unrelated later
      // reload must not apply it. The file is then the only source.
      pending = undefined;
      throw error;
    }
  };

  // `ctx.location.directory` is where this plugin instance loaded. Unlike V1's
  // per-call `context.directory`, it's fixed for the instance's lifetime.
  const env: HostEnv = {
    directory: ctx.location.directory,
    authInstructions: authInstructionsV2(deps.mcpName, ctx.location.directory),
    registerServer: apply,
    reconnectServer: apply,
  };

  // V2 requires the transform callback to be synchronous.
  await ctx.tool.transform((editor) => {
    for (const spec of TOOLS) {
      editor.add({
        name: spec.name,
        description: spec.description,
        input: toJsonSchema(spec.args),
        execute: async (input) => ({ content: await runTool(spec, input, deps, env) }),
      });
    }
  });
};
