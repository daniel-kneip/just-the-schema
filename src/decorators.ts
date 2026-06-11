import { DecoratorContext, ModelProperty, Program, Scalar, Type } from "@typespec/compiler";
import { $lib } from "./lib.js";

const keys = $lib.stateKeys;

export interface ZodOverride {
  type: string;
  from?: string;
}

// Decorator arguments declared as `valueof string` arrive as plain strings;
// without the extern declaration (e.g. in tests) they arrive as StringLiteral types.
function asString(value: string | { value: string } | undefined): string | undefined {
  return typeof value === "object" ? value.value : value;
}

function $zodType(
  context: DecoratorContext,
  target: Scalar | ModelProperty,
  type: string,
  importFrom?: string,
): void {
  context.program.stateMap(keys.zodType).set(target, {
    type: asString(type)!,
    from: asString(importFrom),
  } satisfies ZodOverride);
}

export const $decorators = {
  JustTheSchema: {
    zodType: $zodType,
  },
};

export function getZodType(program: Program, type: Type): ZodOverride | undefined {
  return program.stateMap(keys.zodType).get(type) as ZodOverride | undefined;
}
