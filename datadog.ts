// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// One default export serves both OpenCode runtimes:
//   OpenCode 1.x (>= 1.18.29) calls `server()` and ignores `setup`.
//   OpenCode 2.x calls `setup()` and ignores `server`.
// Nothing is translated between them; both adapters wrap the same core.

import type { PluginModule } from '@opencode-ai/plugin';
import type { Plugin } from '@opencode/plugin';

import { setupV2 } from './adapters/v2.js';
import type { CoreDeps } from './core/types.js';
import { makeConnectionBuilder } from '#shared/url';

// Build-time constants (replaced by bundle.ts — keep inside string literals)
const PLUGIN_VERSION = '0.8.2';
const PLUGIN_ID = 'opencode-plugin';
const MCP_NAME = 'datadog';

const deps: CoreDeps = {
  connection: makeConnectionBuilder({ clientId: PLUGIN_ID, version: PLUGIN_VERSION }),
  mcpName: MCP_NAME,
};

// Typed as `Plugin.define(...)` would return it, without a runtime import that
// V1 couldn't resolve (see adapters/v2.ts).
const v2: Plugin.Plugin = { id: MCP_NAME, setup: (ctx) => setupV2(ctx, deps) };

export default {
  ...v2,
  async server(input) {
    const { serverV1 } = await import('./adapters/v1.js');
    return { tool: await serverV1(input, deps) };
  },
} satisfies PluginModule & Plugin.Plugin;
