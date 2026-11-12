// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import {
  type McpEntry,
  connectionFields,
  defaultEntryPath,
  headerToolsets,
  loadServerState,
  malformedConfigMessage,
  persistEntry,
} from '../config.js';
import { SITE_TABLE, isKnownDomain, resolveSiteToDomain } from '#shared/site';
import { lines } from '#shared/text';
import { defineTool } from './types.js';

export const ddsetup = defineTool({
  name: 'ddsetup',
  description: [
    'Set up the Datadog MCP server for the first time.',
    'Run this when Datadog tools are not available or the MCP server has not been configured.',
    'Accepts a Datadog site code (us1, us3, us5, eu, ap1, ap2, uk1), a Datadog URL, or any MCP domain hostname.',
    "If the user's Datadog site is not in the standard list, ask them for the MCP domain to use.",
  ].join(' '),
  args: {
    site: {
      type: 'string',
      description:
        'Datadog site code (us1, us3, us5, eu, ap1, ap2, uk1), a Datadog URL, or any MCP domain hostname provided by the user',
    },
  },
  async run(args, { connection, mcpName }, env) {
    const state = await loadServerState(env.directory, mcpName);

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

    // Repairing an entry with an unusable URL changes only its `url` and the
    // plugin's own headers (keeping a toolsets header it already has), so its
    // other headers, `oauth` and other fields survive, as with the other tools.
    const repairing = state.entry;
    const fields = connectionFields(connection, domain, headerToolsets(repairing?.headers) ?? '', repairing?.headers);
    const entry: McpEntry = repairing
      ? { ...repairing, type: 'remote', ...fields }
      : { type: 'remote', ...fields, oauth: {} };
    await persistEntry(env.directory, state.read, state.path ?? defaultEntryPath(mcpName), entry);

    let runtimeNote: string | false = false;
    try {
      await env.registerServer(entry);
    } catch {
      runtimeNote =
        'Note: the server could not be registered in the current session. The user should restart OpenCode.';
    }

    // A repaired key-auth entry keeps `oauth: false`, so there's no sign-in.
    if (entry.oauth === false) {
      return lines(
        `The Datadog MCP server has been configured with domain: ${domain}`,
        unknownDomainNote,
        '',
        'This entry uses API key authentication, so no sign-in is needed.',
        'It connects using the headers set in its config entry.',
        'If Datadog tools do not become available, use ddconfig with action "troubleshoot".',
        runtimeNote,
      );
    }

    return lines(
      `The Datadog MCP server has been configured with domain: ${domain}`,
      unknownDomainNote,
      '',
      'IMPORTANT: Datadog tools are NOT available yet. The user must authenticate first.',
      ...env.authInstructions,
      '',
      'After authentication completes, Datadog tools will become available in this session.',
      'Do NOT attempt to use any Datadog MCP tools until the user confirms authentication is complete.',
      runtimeNote,
    );
  },
});
