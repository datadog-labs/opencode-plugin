import type { McpClient } from '../config.js';
import type { UrlBuilder } from '../url.js';

// Shared dependency record the entry file builds once and hands to each tool
// factory. Lives in `tools/` (not at the repo root) so the entry module never
// imports from here — avoids an import cycle.
export type ToolDeps = { client: McpClient; urls: UrlBuilder; mcpName: string };
