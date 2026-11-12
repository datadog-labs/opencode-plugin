// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// MCP connection metadata, URL construction, and parsing.
//
// `makeConnectionBuilder` is a factory so the entry file can hand in the
// build-time PLUGIN_ID / PLUGIN_VERSION constants (substituted by bundle.ts in
// the entry file only). Everything downstream stays pure.

export const MCP_PATH = '/v1/mcp';

export const REFERRER_NAME_HEADER = 'X-Datadog-MCP-Referrer-Name';
export const REFERRER_VERSION_HEADER = 'X-Datadog-MCP-Referrer-Version';
export const TOOLSETS_HEADER = 'X-Datadog-MCP-Toolsets';
export const DATADOG_HEADERS = [REFERRER_NAME_HEADER, REFERRER_VERSION_HEADER, TOOLSETS_HEADER] as const;

export type McpConnectionConfig = { url: string; headers: Record<string, string>; version: string };
export type ConnectionBuilder = { build(domain: string, toolsets: string): McpConnectionConfig };

// Header-based connections keep the endpoint stable across plugin updates and
// toolset changes. `new URL(path, base)` throws on an invalid base, so callers
// must pass a validated hostname (see site.ts).
export const makeConnectionBuilder = (opts: { clientId: string; version: string }): ConnectionBuilder => ({
  build(domain, toolsets) {
    return {
      url: new URL(MCP_PATH, `https://${domain}`).toString(),
      headers: {
        [REFERRER_NAME_HEADER]: opts.clientId,
        [REFERRER_VERSION_HEADER]: opts.version,
        [TOOLSETS_HEADER]: toolsets,
      },
      version: opts.version,
    };
  },
});
