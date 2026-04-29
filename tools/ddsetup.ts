// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import { tool } from '@opencode-ai/plugin';

import { type McpEntry, addMcpServer, loadServerState, malformedConfigMessage, persistEntry } from '../config.js';
import { SITE_TABLE, isKnownDomain, resolveSiteToDomain } from '../site.js';
import { lines } from '../text.js';
import type { ToolDeps } from './types.js';

export const createDdsetup = ({ client, urls, mcpName }: ToolDeps) =>
  tool({
    description: [
      'Set up the Datadog MCP server for the first time.',
      'Run this when Datadog tools are not available or the MCP server has not been configured.',
      'Provide a Datadog site code (us1, us3, us5, eu, ap1, ap2) or an MCP domain.',
    ].join(' '),
    args: {
      site: tool.schema
        .string()
        .describe('Datadog site code (us1, us3, us5, eu, ap1, ap2), a Datadog URL, or an MCP domain'),
    },
    async execute(args, context) {
      const state = await loadServerState(context.directory, mcpName);

      if (state.kind === 'malformed-config') return malformedConfigMessage(state);
      if (state.kind === 'configured') {
        return lines(
          'The Datadog MCP server is already configured.',
          `Current domain: ${state.parsed.domain}`,
          'To change the domain or troubleshoot, use the ddconfig tool.',
        );
      }

      const domain = resolveSiteToDomain(args.site);
      if (!domain) {
        return lines(
          `Could not resolve "${args.site}" to a Datadog MCP domain.`,
          '',
          'Available sites:',
          SITE_TABLE,
          '',
          'You can also provide an MCP domain directly (e.g. mcp.datadoghq.com).',
        );
      }

      const unknownDomainNote =
        !isKnownDomain(domain) &&
        `Note: "${domain}" is not a known Datadog MCP domain. If the plugin fails to connect, re-run ddsetup with a site code from the list.`;

      const url = urls.build(domain, '');
      const entry: McpEntry = { type: 'remote', url, oauth: {} };
      await persistEntry(context.directory, state.read, mcpName, entry);

      let runtimeNote: string | false = false;
      try {
        await addMcpServer(client, mcpName, url, {});
      } catch {
        runtimeNote =
          'Note: the server could not be registered in the current session. The user should restart OpenCode.';
      }

      return lines(
        `The Datadog MCP server has been configured with domain: ${domain}`,
        unknownDomainNote,
        '',
        'IMPORTANT: Datadog tools are NOT available yet. The user must authenticate first.',
        'Tell the user to run this command in a separate terminal:',
        '',
        `  opencode mcp auth ${mcpName}`,
        '',
        'After authentication completes, Datadog tools will become available in this session.',
        'Do NOT attempt to use any Datadog MCP tools until the user confirms authentication is complete.',
        runtimeNote,
      );
    },
  });
