// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import { isDeepStrictEqual } from 'node:util';

import { type McpEntry, connectionFields, isLegacyUrl, loadServerState, persistEntry, stableUrl } from '../config.js';
import type { CoreDeps } from './types.js';

// Rewrites a legacy Datadog entry into the stable form: its URL with the legacy
// parts removed (see `stableUrl`) plus X-Datadog-MCP-* headers. Toolsets, other
// headers and every other field are kept, as are the URL's scheme, host, port
// and any other query params. Legacy entries (see `isLegacyUrl`) are:
//   - plugin-written before MCPS-394: /api/unstable/mcp-server/mcp?referrer_ide=…&plugin_version=…[&toolsets=…]
//   - plugin-written since:           /v1/mcp?referrer_ide=…&plugin_version=…[&toolsets=…]
//   - hand-written from the README's key-auth example before MCPS-394:
//                                     /api/unstable/mcp-server/mcp
// Both adapters run this once when the plugin loads.
//
// Only the config file changes. The running server is left alone, so the
// session keeps the connection it started with, and OpenCode picks up the new
// URL the next time it loads its config.
//
// Never throws: a migration failure must not stop the plugin from loading. A
// malformed or unreadable config is left for the tools to report.
export const migrateLegacyEntry = async ({ connection, mcpName }: CoreDeps, directory: string): Promise<void> => {
  try {
    const state = await loadServerState(directory, mcpName);
    if (state.kind !== 'configured' || state.entry.type !== 'remote' || !isLegacyUrl(state.entry.url)) {
      return;
    }
    const { entry, parsed } = state;
    const { headers } = connectionFields(connection, parsed.domain, parsed.toolsets, entry.headers);
    const migrated: McpEntry = { ...entry, url: stableUrl(entry.url), headers };
    // `isLegacyUrl` reads the parsed URL and `stableUrl` edits the text, so an
    // odd spelling (a backslash path, say) can stay "legacy" after the rewrite.
    // Skipping a write that changes nothing stops that from rewriting the file,
    // and touching its mtime, on every load.
    if (isDeepStrictEqual(migrated, entry)) return;
    await persistEntry(directory, state.read, state.path, migrated);
  } catch {
    // See above: never block plugin load.
  }
};
