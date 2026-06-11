import {
  Enum,
  Model,
  ModelProperty,
  Namespace,
  Program,
  Scalar,
  StringTemplate,
  Type,
  Union,
  getDoc,
  getMaxItems,
  getMaxLength,
  getMaxValue,
  getMinItems,
  getMinLength,
  getMinValue,
  getPattern,
  isArrayModelType,
  isRecordModelType,
  isTemplateDeclaration,
} from "@typespec/compiler";
import { ZodOverride, getZodType } from "./decorators.js";

type Declaration = Model | Scalar | Enum | Union;

interface Context {
  program: Program;
  imports: Map<string, Set<string>>;
  statements: string[];
  status: Map<Declaration, "emitting" | "done">;
  // Counts back-edge references to declarations currently being emitted; the
  // nearest enclosing property (getter) or declaration (z.lazy) absorbs them.
  cycles: number;
}

const scalarMap: Record<string, string> = {
  string: "z.string()",
  boolean: "z.boolean()",
  bytes: "z.instanceof(Uint8Array)",
  int64: "z.bigint()",
  uint64: "z.bigint()",
  numeric: "z.number()",
  integer: "z.int()",
  float: "z.number()",
  decimal: "z.number()",
  decimal128: "z.number()",
  float32: "z.number()",
  float64: "z.number()",
  int32: "z.int()",
  int16: "z.int()",
  int8: "z.int()",
  safeint: "z.int()",
  uint32: "z.int()",
  uint16: "z.int()",
  uint8: "z.int()",
  url: "z.url()",
  plainDate: "z.iso.date()",
  plainTime: "z.iso.time()",
  utcDateTime: "z.iso.datetime()",
  offsetDateTime: "z.iso.datetime({ offset: true })",
  duration: "z.iso.duration()",
};

export function emitSchemas(program: Program): string {
  const ctx: Context = {
    program,
    imports: new Map(),
    statements: [],
    status: new Map(),
    cycles: 0,
  };
  collectNamespace(ctx, program.getGlobalNamespaceType());
  const imports = ['import { z } from "zod";', ...importLines(ctx)];
  return [...imports, "", ...ctx.statements].join("\n") + "\n";
}

function importLines(ctx: Context): string[] {
  return [...ctx.imports].map(
    ([module, names]) => `import { ${[...names].sort().join(", ")} } from ${JSON.stringify(module)};`,
  );
}

function collectNamespace(ctx: Context, ns: Namespace): void {
  for (const model of ns.models.values()) emitDeclaration(ctx, model);
  for (const scalar of ns.scalars.values()) emitDeclaration(ctx, scalar);
  for (const en of ns.enums.values()) emitDeclaration(ctx, en);
  for (const union of ns.unions.values()) if (union.name) emitDeclaration(ctx, union);
  for (const child of ns.namespaces.values()) {
    if (child.name === "TypeSpec" && !child.namespace?.namespace) continue;
    collectNamespace(ctx, child);
  }
}

function emitDeclaration(ctx: Context, decl: Declaration): void {
  if (ctx.status.get(decl)) return;
  // Zod consts cannot be generic: skip template declarations, instantiations are inlined.
  if (decl.kind !== "Enum" && isTemplateDeclaration(decl)) {
    ctx.status.set(decl, "done");
    return;
  }
  ctx.status.set(decl, "emitting");
  const before = ctx.cycles;
  let expr = declarationExpr(ctx, decl);
  if (ctx.cycles > before) {
    ctx.cycles = before;
    expr = `z.lazy(() => ${expr})`;
  }
  ctx.statements.push(withDoc(ctx, decl, "", `export const ${decl.name} = ${expr};`));
  ctx.status.set(decl, "done");
}

function declarationExpr(ctx: Context, decl: Declaration): string {
  switch (decl.kind) {
    case "Model":
      return isArrayModelType(decl)
        ? `z.array(${typeToExpr(ctx, decl.indexer.value, "")})`
        : objectExpr(ctx, decl, "");
    case "Scalar":
      return scalarExpr(ctx, decl) + constraintChecks(ctx, decl);
    case "Enum":
      return enumExpr(decl);
    case "Union":
      return unionExpr(ctx, decl, "");
  }
}

function objectExpr(ctx: Context, model: Model, indent: string): string {
  const inner = indent + "    ";
  const base = baseRef(ctx, model);
  const chunks = modelProperties(ctx, model).map((prop) => {
    const before = ctx.cycles;
    const expr = propertyExpr(ctx, prop, inner);
    const cyclic = ctx.cycles > before;
    ctx.cycles = before;
    const entry = cyclic
      ? `get ${propertyName(prop.name)}() { return ${expr}; }`
      : `${propertyName(prop.name)}: ${expr}`;
    return withDoc(ctx, prop, inner, inner + entry);
  });
  const head = base ? `${base}.extend` : "z.object";
  let expr = chunks.length === 0 ? `${head}({})` : `${head}({\n${chunks.join(",\n")}\n${indent}})`;
  if (model.indexer && model.indexer.key.name === "string") {
    expr += `.catchall(${typeToExpr(ctx, model.indexer.value, indent)})`;
  }
  return expr;
}

function baseRef(ctx: Context, model: Model): string | undefined {
  const base = model.baseModel;
  if (!base || !base.name || inStdNamespace(base) || base.templateMapper) return undefined;
  emitDeclaration(ctx, base);
  return base.name;
}

// Bases that cannot be referenced (template instances) get their properties inlined.
function modelProperties(ctx: Context, model: Model): ModelProperty[] {
  const base = model.baseModel;
  const inherited = base && !baseRef(ctx, model) ? modelProperties(ctx, base) : [];
  return [...inherited, ...model.properties.values()];
}

function propertyExpr(ctx: Context, prop: ModelProperty, indent: string): string {
  const override = getZodType(ctx.program, prop);
  const expr = override
    ? overrideExpr(ctx, override)
    : typeToExpr(ctx, prop.type, indent) + constraintChecks(ctx, prop);
  return prop.optional ? expr + ".optional()" : expr;
}

function constraintChecks(ctx: Context, type: Scalar | ModelProperty): string {
  const p = ctx.program;
  const suffix = bigintSuffix(type);
  let checks = "";
  const min = getMinValue(p, type) ?? getMinLength(p, type) ?? getMinItems(p, type);
  if (min !== undefined) checks += `.min(${min}${suffix})`;
  const max = getMaxValue(p, type) ?? getMaxLength(p, type) ?? getMaxItems(p, type);
  if (max !== undefined) checks += `.max(${max}${suffix})`;
  const pattern = getPattern(p, type);
  if (pattern !== undefined) checks += `.regex(/${pattern.replace(/\//g, "\\/")}/)`;
  return checks;
}

// z.bigint() checks take bigint literals (1n), all other checks take numbers.
function bigintSuffix(type: Scalar | ModelProperty): string {
  let scalar: Scalar | undefined =
    type.kind === "Scalar" ? type : type.type.kind === "Scalar" ? type.type : undefined;
  while (scalar) {
    const mapped = scalarMap[scalar.name];
    if (mapped) return mapped === "z.bigint()" ? "n" : "";
    scalar = scalar.baseScalar;
  }
  return "";
}

function enumExpr(en: Enum): string {
  const values = [...en.members.values()].map((member) => member.value ?? member.name);
  return values.every((value) => typeof value === "string")
    ? `z.enum([${values.map((value) => JSON.stringify(value)).join(", ")}])`
    : `z.union([${values.map((value) => `z.literal(${JSON.stringify(value)})`).join(", ")}])`;
}

function unionExpr(ctx: Context, union: Union, indent: string): string {
  const variants = [...union.variants.values()].map((variant) =>
    typeToExpr(ctx, variant.type, indent),
  );
  return `z.union([${variants.join(", ")}])`;
}

function scalarExpr(ctx: Context, scalar: Scalar): string {
  const override = getZodType(ctx.program, scalar);
  if (override) return overrideExpr(ctx, override);
  const base = scalar.baseScalar;
  if (!base) return "z.unknown()";
  if (inStdNamespace(base)) return stdScalarExpr(ctx, base);
  emitDeclaration(ctx, base);
  return base.name;
}

function stdScalarExpr(ctx: Context, scalar: Scalar): string {
  let current: Scalar | undefined = scalar;
  while (current) {
    const override = getZodType(ctx.program, current);
    if (override) return overrideExpr(ctx, override);
    const mapped = scalarMap[current.name];
    if (mapped) return mapped;
    current = current.baseScalar;
  }
  return "z.unknown()";
}

function namedRef(ctx: Context, type: Declaration): string | undefined {
  if (!type.name || inStdNamespace(type)) return undefined;
  if (type.kind !== "Enum" && type.templateMapper) return undefined;
  if (ctx.status.get(type) === "emitting") {
    ctx.cycles++;
    return type.name;
  }
  emitDeclaration(ctx, type);
  return type.name;
}

function typeToExpr(ctx: Context, type: Type, indent: string): string {
  switch (type.kind) {
    case "Model": {
      // Inside template declarations Array<T>/Record<T> instances carry no
      // indexer yet, so resolve them via their template argument instead.
      if ((type.name === "Array" || type.name === "Record") && inStdNamespace(type)) {
        const element = type.indexer?.value ?? templateArg(type);
        const elementExpr = element ? typeToExpr(ctx, element, indent) : "z.unknown()";
        return type.name === "Array"
          ? `z.array(${elementExpr})`
          : `z.record(z.string(), ${elementExpr})`;
      }
      const ref = namedRef(ctx, type);
      if (ref) return ref;
      if (isArrayModelType(type)) return `z.array(${typeToExpr(ctx, type.indexer.value, indent)})`;
      if (isRecordModelType(type)) {
        return `z.record(z.string(), ${typeToExpr(ctx, type.indexer.value, indent)})`;
      }
      return objectExpr(ctx, type, indent);
    }
    case "Scalar":
      return inStdNamespace(type) ? stdScalarExpr(ctx, type) : (namedRef(ctx, type) ?? "z.unknown()");
    case "Enum":
      return namedRef(ctx, type) ?? "z.unknown()";
    case "EnumMember":
      return `z.literal(${JSON.stringify(type.value ?? type.name)})`;
    case "Union": {
      const ref = type.name ? namedRef(ctx, type) : undefined;
      return ref ?? unionExpr(ctx, type, indent);
    }
    case "Tuple":
      return `z.tuple([${type.values.map((value) => typeToExpr(ctx, value, indent)).join(", ")}])`;
    case "String":
    case "Number":
    case "Boolean":
      return `z.literal(${JSON.stringify(type.value)})`;
    case "StringTemplate":
      return templateLiteralExpr(ctx, type, indent);
    case "Intrinsic":
      switch (type.name) {
        case "null":
          return "z.null()";
        case "void":
          return "z.void()";
        case "never":
          return "z.never()";
        default:
          return "z.unknown()";
      }
    default:
      return "z.unknown()";
  }
}

function templateLiteralExpr(ctx: Context, template: StringTemplate, indent: string): string {
  if (template.stringValue !== undefined) {
    return `z.literal(${JSON.stringify(template.stringValue)})`;
  }
  const parts = template.spans
    .filter((span) => span.isInterpolated || (span.type as Type & { value: string }).value !== "")
    .map((span) =>
      span.isInterpolated
        ? typeToExpr(ctx, span.type, indent)
        : JSON.stringify((span.type as Type & { value: string }).value),
    );
  return `z.templateLiteral([${parts.join(", ")}])`;
}

function templateArg(type: Model): Type | undefined {
  const arg = type.templateMapper?.args[0];
  return arg?.entityKind === "Type" ? arg : undefined;
}

function overrideExpr(ctx: Context, override: ZodOverride): string {
  if (override.from) {
    const root = override.type.split(/[.(<]/)[0];
    const names = ctx.imports.get(override.from) ?? new Set();
    names.add(root);
    ctx.imports.set(override.from, names);
  }
  return override.type;
}

function propertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function inStdNamespace(type: { namespace?: Namespace }): boolean {
  let ns = type.namespace;
  while (ns?.namespace) {
    if (!ns.namespace.name && !ns.namespace.namespace) return ns.name === "TypeSpec";
    ns = ns.namespace;
  }
  return false;
}

function withDoc(ctx: Context, type: Type, indent: string, statement: string): string {
  const doc = getDoc(ctx.program, type);
  if (!doc) return statement;
  // Escape "*/" so a doc comment containing it cannot terminate the block early.
  const safe = doc.replace(/\*\//g, "*\\/").replace(/\n/g, `\n${indent} * `);
  return `${indent}/** ${safe} */\n${statement}`;
}
