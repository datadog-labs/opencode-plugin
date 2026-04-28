// MCP URL construction and parsing.
//
// `makeUrlBuilder` is a factory so the entry file can hand in the build-time
// PLUGIN_ID / PLUGIN_VERSION constants (substituted by bundle.ts in the entry
// file only). Everything downstream stays pure.

const MCP_PATH = '/api/unstable/mcp-server/mcp';

export type ParsedUrl = { domain: string; toolsets: string };

export const parseMcpUrl = (url: string): ParsedUrl | undefined => {
  try {
    const parsed = new URL(url);
    return {
      domain: parsed.hostname + (parsed.port ? `:${parsed.port}` : ''),
      toolsets: parsed.searchParams.get('toolsets') ?? '',
    };
  } catch {
    return undefined;
  }
};

export type UrlBuilder = { build(domain: string, toolsets: string): string };

export const makeUrlBuilder = (opts: { clientId: string; version: string }): UrlBuilder => ({
  build(domain, toolsets) {
    // `new URL(path, base)` throws on an invalid base, so callers must pass a
    // validated hostname (see site.ts). `searchParams.set` percent-encodes.
    const url = new URL(MCP_PATH, `https://${domain}`);
    url.searchParams.set('referrer_ide', opts.clientId);
    url.searchParams.set('plugin_version', opts.version);
    if (toolsets) url.searchParams.set('toolsets', toolsets);
    return url.toString();
  },
});
