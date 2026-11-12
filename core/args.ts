// Unless explicitly stated otherwise all files in this repository are licensed under the Apache-2.0 License.
// This product includes software developed at Datadog (https://www.datadoghq.com/) Copyright 2026 Datadog, Inc.

// Tool argument specs as plain data. Each host adapter derives its own schema
// from these (V1: `tool.schema` builders, V2: JSON Schema), so the argument
// surface is defined once and both runtimes expose identical tools.

type BaseSpec = { readonly description: string; readonly optional?: boolean };

export type ArgSpec =
  | (BaseSpec & { readonly type: 'string' })
  | (BaseSpec & { readonly type: 'boolean' })
  | (BaseSpec & { readonly type: 'enum'; readonly values: readonly [string, ...string[]] });

export type ArgSpecs = Readonly<Record<string, ArgSpec>>;

type ValueOf<S extends ArgSpec> = S extends { type: 'enum'; values: readonly (infer V)[] }
  ? V
  : S extends { type: 'boolean' }
    ? boolean
    : string;

type OptionalKeys<T extends ArgSpecs> = { [K in keyof T]: T[K] extends { optional: true } ? K : never }[keyof T];

export type ArgsOf<T extends ArgSpecs> = { -readonly [K in Exclude<keyof T, OptionalKeys<T>>]: ValueOf<T[K]> } & {
  -readonly [K in OptionalKeys<T>]?: ValueOf<T[K]>;
};

export type JsonSchemaObject = {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};

const propertySchema = (spec: ArgSpec): Record<string, unknown> => {
  if (spec.type === 'enum') return { type: 'string', enum: [...spec.values], description: spec.description };
  return { type: spec.type, description: spec.description };
};

export const toJsonSchema = (specs: ArgSpecs): JsonSchemaObject => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, propertySchema(spec)])),
  required: Object.entries(specs)
    .filter(([, spec]) => !spec.optional)
    .map(([name]) => name),
  additionalProperties: false,
});

export type ParseResult<T extends ArgSpecs> = { ok: true; args: ArgsOf<T> } | { ok: false; error: string };

const matches = (spec: ArgSpec, value: unknown): boolean => {
  if (spec.type === 'boolean') return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  return spec.type === 'string' || spec.values.includes(value);
};

const expected = (spec: ArgSpec): string =>
  spec.type === 'enum' ? `one of ${spec.values.map((v) => `"${v}"`).join(', ')}` : `a ${spec.type}`;

// Runtime guard for tool input. V1 validates through zod before `execute`, but
// V2 hands `execute` an untyped `input`, so every adapter routes through this
// check rather than trusting the host. `null` is treated as omitted because
// some models emit it for optional parameters.
export const parseArgs = <T extends ArgSpecs>(specs: T, input: unknown): ParseResult<T> => {
  const raw = input ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Tool input must be an object.' };

  const record = raw as Record<string, unknown>;
  const args: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const value = record[name];
    if (value === undefined || value === null) {
      if (!spec.optional) return { ok: false, error: `Missing required argument "${name}".` };
      continue;
    }
    if (!matches(spec, value)) return { ok: false, error: `Argument "${name}" must be ${expected(spec)}.` };
    args[name] = value;
  }
  return { ok: true, args: args as ArgsOf<T> };
};
