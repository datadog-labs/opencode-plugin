import type { PluginModule } from '@opencode-ai/plugin';

import { createDdconfig } from './tools/ddconfig.js';
import { createDdsetup } from './tools/ddsetup.js';
import { createDdtoolsets } from './tools/ddtoolsets.js';
import { makeUrlBuilder } from './url.js';

// Build-time constants (replaced by bundle.ts — keep inside string literals)
const PLUGIN_VERSION = '0.7.3';
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

