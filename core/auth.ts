// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// Quotes `value` for a POSIX shell when it contains anything but plain path
// characters, so the command can be pasted as is.
const shellQuote = (value: string): string => (/^[\w./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

// The terminal fallback for signing in, shared by both runtimes. The Datadog
// server is configured in the project's OpenCode config, so `opencode mcp auth`
// only finds it when run from the project directory.
export const terminalAuthLines = (mcpName: string, directory: string): readonly string[] => [
  'Run it from the project directory, where the Datadog server is configured:',
  '',
  `  cd ${shellQuote(directory)} && opencode mcp auth ${mcpName}`,
];
