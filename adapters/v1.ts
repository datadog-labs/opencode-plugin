// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// OpenCode 1.x adapter. V1 calls the default export's `server({ client })` and
// reads the returned `tool` map. Each tool resolves the project directory per
// call (`context.directory`) and applies config changes live through the V1
// SDK's `client.mcp.add` / `client.mcp.disconnect`.

import { type PluginInput, type ToolDefinition, tool } from '@opencode-ai/plugin';

import type { ArgSpec } from '../core/args.js';
import { terminalAuthLines } from '../core/auth.js';
import { TOOLS, runTool } from '../core/index.js';
import { migrateLegacyEntry } from '../core/migrate.js';
import type { CoreDeps, HostEnv, ToolSpec } from '../core/types.js';
import { type McpEntry, resolveEnv, substituteEnv } from '../config.js';

type V1Client = PluginInput['client'];

const toV1Arg = (spec: ArgSpec) => {
  const base =
    spec.type === 'enum'
      ? tool.schema.enum(spec.values)
      : spec.type === 'boolean'
        ? tool.schema.boolean()
        : tool.schema.string();
  return (spec.optional ? base.optional() : base).describe(spec.description);
};

export const toV1Args = (spec: ToolSpec) =>
  Object.fromEntries(Object.entries(spec.args).map(([name, arg]) => [name, toV1Arg(arg)]));

// Preserve the caller's oauth choice when re-registering the server live:
//   false      → disable OAuth (key-auth flow)
//   object/{}  → enable OAuth with those options
//   undefined  → default (enable OAuth auto-detection with empty options)
const normalizeOauth = (oauth: McpEntry['oauth']): McpEntry['oauth'] => (oauth === false ? false : (oauth ?? {}));

export const makeV1Env = (client: V1Client, mcpName: string, directory: string): HostEnv => {
  const add = async (entry: McpEntry) => {
    // Headers carry the toolsets and referrer, and any API keys the user added,
    // so they must reach the live server too. `client.mcp.add` does no
    // substitution, so `{env:…}` is resolved here, in the URL as well as the
    // headers; the file keeps the placeholders.
    //
    // The entry may be in V1's shape (`mcp.<name>`) or V2's (`mcp.servers.<name>`),
    // and the file isn't validated against either, so read the runtime settings
    // defensively. A disabled entry stays disabled live: V1's `enabled`, or V2's
    // `disabled: true`. Only a numeric `timeout` is V1's; V2's object form
    // (`{ startup, catalog, execution }`) has no single V1 equivalent and would
    // make `client.mcp.add` reject the registration, so it's left out.
    const headers = entry.headers && substituteEnv(entry.headers);
    const raw = entry as Record<string, unknown>;
    const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : raw.disabled === true ? false : undefined;
    const timeout = typeof raw.timeout === 'number' ? raw.timeout : undefined;
    await client.mcp.add({
      body: {
        name: mcpName,
        config: {
          type: 'remote',
          url: resolveEnv(entry.url),
          ...(headers && { headers }),
          oauth: normalizeOauth(entry.oauth),
          ...(enabled !== undefined && { enabled }),
          ...(timeout !== undefined && { timeout }),
        },
      },
    });
  };
  return {
    directory,
    authInstructions: [
      'Tell the user to run this command in a separate terminal.',
      ...terminalAuthLines(mcpName, directory),
    ],
    registerServer: add,
    async reconnectServer(entry) {
      await client.mcp.disconnect({ path: { name: mcpName } });
      await add(entry);
    },
  };
};

// Runs from `server()` at plugin load. `directory` is the instance's project
// directory, used only to migrate a legacy entry before the tools register.
export const serverV1 = async (
  { client, directory }: Pick<PluginInput, 'client' | 'directory'>,
  deps: CoreDeps,
): Promise<Record<string, ToolDefinition>> => {
  await migrateLegacyEntry(deps, directory);
  return Object.fromEntries(
    TOOLS.map((spec) => [
      spec.name,
      tool({
        description: spec.description,
        args: toV1Args(spec),
        execute: (args, context) => runTool(spec, args, deps, makeV1Env(client, deps.mcpName, context.directory)),
      }),
    ]),
  );
};
