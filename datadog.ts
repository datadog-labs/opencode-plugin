// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import { z } from "zod";

import { createDdconfig } from "./tools/ddconfig.js";
import { createDdsetup } from "./tools/ddsetup.js";
import { createDdtoolsets } from "./tools/ddtoolsets.js";
import { makeUrlBuilder } from "./url.js";

// Build-time constants (replaced by bundle.ts — keep inside string literals)
const PLUGIN_VERSION = "0.7.13";
const PLUGIN_ID = "opencode-plugin";
const MCP_NAME = "datadog";

export default {
  id: "datadog-opencode-plugin",
  async setup(ctx) {
    const directory = ctx.location.directory;
    const client = {
      mcp: {
        add: async ({ body }) => {
          await ctx.mcp.transform((editor) =>
            editor.set(body.name, body.config),
          );
        },
        disconnect: async ({ path }) => {
          await ctx.mcp.transform((editor) => editor.remove(path.name));
        },
      },
    } as any;
    const urls = makeUrlBuilder({
      clientId: PLUGIN_ID,
      version: PLUGIN_VERSION,
    });
    const deps = { client, urls, mcpName: MCP_NAME };

    const legacyTools = {
      ddsetup: createDdsetup(deps),
      ddconfig: createDdconfig(deps),
      ddtoolsets: createDdtoolsets(deps),
    };

    for (const [name, legacy] of Object.entries(legacyTools)) {
      await ctx.tool.transform((editor) => {
        editor.add({
          name,
          description: legacy.description,
          input: z.object(legacy.args),
          execute: async (input, toolContext) => {
            const result = await legacy.execute(input as never, {
              directory,
              sessionID: toolContext.sessionID,
              messageID: toolContext.messageID,
              agent: toolContext.agent,
              abort: toolContext.signal,
              metadata: () => undefined,
              ask: async () => undefined,
            });
            return typeof result === "string" ? { output: result } : result;
          },
        });
      });
    }
  },
};
