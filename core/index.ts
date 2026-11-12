// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

import { parseArgs } from './args.js';
import { ddconfig } from './ddconfig.js';
import { ddsetup } from './ddsetup.js';
import { ddtoolsets } from './ddtoolsets.js';
import type { CoreDeps, HostEnv, ToolSpec } from './types.js';

// Every tool the plugin exposes, in registration order. Adapters iterate this
// list, so adding a tool here makes it appear on both runtimes.
// The cast widens each `ToolSpec<A>` to `ToolSpec<ArgSpecs>`. TypeScript
// rejects that directly because `run`'s args parameter is contravariant. It's
// safe because callers go through `runTool`, which validates input against the
// same spec before calling `run`.
export const TOOLS: readonly ToolSpec[] = [ddsetup, ddconfig, ddtoolsets] as unknown as readonly ToolSpec[];

// Validates raw host input against the tool's arg specs, then runs it. Invalid
// input comes back as a message rather than a throw, so the agent can retry.
export const runTool = async (spec: ToolSpec, input: unknown, deps: CoreDeps, env: HostEnv): Promise<string> => {
  const parsed = parseArgs(spec.args, input);
  if (!parsed.ok) return `Invalid arguments for ${spec.name}: ${parsed.error}`;
  return spec.run(parsed.args, deps, env);
};
