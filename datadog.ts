// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import type { PluginModule } from '@opencode-ai/plugin';

import { createDdconfig } from './tools/ddconfig.js';
import { createDdsetup } from './tools/ddsetup.js';
import { createDdtoolsets } from './tools/ddtoolsets.js';
import { makeUrlBuilder } from './url.js';

// Build-time constants (replaced by bundle.ts — keep inside string literals)
const PLUGIN_VERSION = '0.7.13';
const PLUGIN_ID = 'opencode-plugin';
const MCP_NAME = 'datadog';

export default {
  id: MCP_NAME,
  async server({ client }) {
    const urls = makeUrlBuilder({ clientId: PLUGIN_ID, version: PLUGIN_VERSION });
    const deps = { client, urls, mcpName: MCP_NAME };
    return {
      tool: { ddsetup: createDdsetup(deps), ddconfig: createDdconfig(deps), ddtoolsets: createDdtoolsets(deps) },
    };
  },
} satisfies PluginModule;
