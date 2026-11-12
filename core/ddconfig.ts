// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import {
  type McpEntry,
  connectionFields,
  loadServerState,
  malformedConfigMessage,
  movedUrl,
  persistEntry,
} from '../config.js';
import { SITE_TABLE, domainToSite, isKnownDomain, resolveSiteToDomain } from '#shared/site';
import { lines } from '#shared/text';
import { defineTool } from './types.js';

export const ddconfig = defineTool({
  name: 'ddconfig',
  description: [
    'Configure or troubleshoot the Datadog MCP server.',
    'Use to view the current configuration, change the Datadog domain or site,',
    'or diagnose connection issues.',
  ].join(' '),
  args: {
    action: {
      type: 'enum',
      values: ['status', 'change-site', 'troubleshoot'],
      optional: true,
      description: 'Action to perform. Omit to show current status.',
    },
    site: {
      type: 'string',
      optional: true,
      description:
        'New Datadog site code (us1, us3, us5, eu, ap1, ap2, uk1), a Datadog URL, or any MCP domain hostname (for change-site action)',
    },
  },
  async run(args, { connection, mcpName }, env) {
    const state = await loadServerState(env.directory, mcpName);

    if (state.kind === 'malformed-config') return malformedConfigMessage(state);
    if (state.kind === 'not-setup') {
      return 'The Datadog MCP server has not been set up. Use the ddsetup tool first.';
    }

    const { entry, parsed } = state;
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

      // Only the host (and, for a known Datadog domain, the scheme and path)
      // changes; other query params and headers are kept.
      const newEntry: McpEntry = {
        ...entry,
        url: movedUrl(entry.url, newDomain),
        headers: connectionFields(connection, newDomain, currentToolsets, entry.headers).headers,
      };
      await persistEntry(env.directory, state.read, state.path, newEntry);

      const newSite = domainToSite(newDomain);
      const header = `Domain changed from ${currentDomain} to ${newDomain}${newSite ? ` (${newSite})` : ''}.`;

      try {
        await env.reconnectServer(newEntry);
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
