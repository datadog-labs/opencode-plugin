// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// The port between the host-agnostic tool core and each OpenCode runtime
// adapter (adapters/v1.ts, adapters/v2.ts). The core only reads and writes the
// project config files and formats messages; everything that talks to the
// running OpenCode instance goes through `HostEnv`.

import type { ArgSpecs, ArgsOf } from './args.js';
import type { McpEntry } from '../config.js';
import type { ConnectionBuilder } from '#shared/url';

// Built once by the entry file from build-time constants.
export type CoreDeps = { readonly connection: ConnectionBuilder; readonly mcpName: string };

export type HostEnv = {
  // Project directory whose config files (see CONFIG_FILES) the tools read and edit.
  readonly directory: string;
  // Lines telling the agent how the user completes OAuth sign-in.
  readonly authInstructions: readonly string[];
  // Make a freshly configured server live in the running session.
  registerServer(entry: McpEntry): Promise<void>;
  // Apply a changed entry (new domain URL or toolsets header) to the running session.
  reconnectServer(entry: McpEntry): Promise<void>;
};

export type ToolSpec<A extends ArgSpecs = ArgSpecs> = {
  readonly name: string;
  readonly description: string;
  readonly args: A;
  run(args: ArgsOf<A>, deps: CoreDeps, env: HostEnv): Promise<string>;
};

// Identity helper that infers `A` from the literal `args`, so `run` gets
// precisely typed arguments.
export const defineTool = <const A extends ArgSpecs>(spec: ToolSpec<A>): ToolSpec<A> => spec;
