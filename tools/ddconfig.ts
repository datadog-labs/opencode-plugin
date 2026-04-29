// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import { tool } from '@opencode-ai/plugin';

import { type McpEntry, loadServerState, malformedConfigMessage, persistEntry, reconnectMcpServer } from '../config.js';
import { SITE_TABLE, domainToSite, isKnownDomain, resolveSiteToDomain } from '../site.js';
import { lines } from '../text.js';
import type { ToolDeps } from './types.js';

export const createDdconfig = ({ client, urls, mcpName }: ToolDeps) =>
  tool({
    description: [
      'Configure or troubleshoot the Datadog MCP server.',
      'Use to view the current configuration, change the Datadog domain or site,',
      'or diagnose connection issues.',
    ].join(' '),
    args: {
      action: tool.schema
        .enum(['status', 'change-site', 'troubleshoot'])
        .optional()
        .describe('Action to perform. Omit to show current status.'),
      site: tool.schema.string().optional().describe('New Datadog site or MCP domain (for change-site action)'),
    },
    async execute(args, context) {
      const state = await loadServerState(context.directory, mcpName);

      if (state.kind === 'malformed-config') return malformedConfigMessage(state);
      if (state.kind === 'not-setup') {
        return 'The Datadog MCP server has not been set up. Use the ddsetup tool first.';
      }

      const { entry, parsed, read } = state;
      const currentDomain = parsed.domain;
      const currentSite = domainToSite(currentDomain);
      const currentToolsets = parsed.toolsets;
      const action = args.action ?? 'status';

      if (action === 'status') {
        return lines(
          'Datadog MCP server configuration:',
          `  Domain: ${currentDomain}`,
          currentSite && `  Site: ${currentSite}`,
          currentToolsets ? `  Toolsets: ${currentToolsets}` : '  Toolsets: (server defaults)',
          entry.oauth === false ? '  Auth: API key' : '  Auth: OAuth',
          '',
          'Available actions:',
          '  - Use ddconfig with action "change-site" to switch domains',
          '  - Use ddconfig with action "troubleshoot" to diagnose issues',
          '  - Use ddtoolsets to manage toolsets',
        );
      }

      if (action === 'change-site') {
        if (!args.site) {
          return lines(
            `Current domain: ${currentDomain}${currentSite ? ` (${currentSite})` : ''}`,
            '',
            'Provide a site code or MCP domain to switch to:',
            SITE_TABLE,
          );
        }

        const newDomain = resolveSiteToDomain(args.site);
        if (!newDomain) {
          return lines(`Could not resolve "${args.site}" to a Datadog MCP domain.`, '', 'Available sites:', SITE_TABLE);
        }

        if (newDomain === currentDomain) {
          return `The domain is already set to ${currentDomain}. No changes needed.`;
        }

        const unknownDomainNote =
          !isKnownDomain(newDomain) &&
          `Note: "${newDomain}" is not a known Datadog MCP domain. If the plugin fails to connect, re-run ddconfig with a site code from the list.`;

        const newUrl = urls.build(newDomain, currentToolsets);
        const newEntry: McpEntry = { ...entry, url: newUrl };
        await persistEntry(context.directory, read, mcpName, newEntry);

        const newSite = domainToSite(newDomain);
        const header = `Domain changed from ${currentDomain} to ${newDomain}${newSite ? ` (${newSite})` : ''}.`;

        try {
          await reconnectMcpServer(client, mcpName, newUrl, entry.oauth);
          return lines(
            header,
            unknownDomainNote,
            '',
            'The MCP server is reconnecting.',
            'If authentication is required, follow the prompt from OpenCode to complete sign-in.',
          );
        } catch {
          return lines(header, unknownDomainNote, '', 'Restart OpenCode for the changes to take effect.');
        }
      }

      // action === 'troubleshoot'
      return lines(
        'The Datadog MCP server is configured but may not be responding.',
        '',
        `Current domain: ${currentDomain}${currentSite ? ` (${currentSite})` : ''}`,
        '',
        'Common causes:',
        `  1. Domain issue — verify "${currentDomain}" is correct for your Datadog site.`,
        '     Use ddconfig with action "change-site" to update if needed.',
        '  2. Authentication — OAuth tokens may have expired.',
        '     Restart OpenCode and re-authenticate when prompted.',
        '  3. Network or access — your network may be blocking the connection,',
        '     or your Datadog account may not have the MCP Read permission.',
      );
    },
  });
