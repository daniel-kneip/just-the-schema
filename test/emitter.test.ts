import { createTestHost } from "@typespec/compiler/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { $decorators } from "../src/decorators.js";
import { emitSchemas } from "../src/emitter.js";

async function emit(code: string): Promise<string> {
  const host = await createTestHost();
  host.addJsFile("jts.js", { $decorators });
  host.addTypeSpecFile("main.tsp", `import "./jts.js";\nusing JustTheSchema;\n${code}`);
  await host.compile("main.tsp");
  return emitSchemas(host.program);
}

// Evaluate emitted code against the real zod instance to prove the output runs.
function load(code: string): Record<string, z.ZodType> {
  const body = code.replace(/^import .*$/gm, "").replace(/^export const /gm, "const ");
  const names = [...code.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentionally evaluating the emitted schema against the real zod runtime
  const factory = new Function("z", `${body}\nreturn { ${names.join(", ")} };`) as (
    z: typeof import("zod").z,
  ) => Record<string, z.ZodType>;
  return factory(z);
}

describe("emitSchemas", () => {
  it("emits a model as z.object", async () => {
    const result = await emit(`
      model Pet {
        name: string;
        age: int32;
        tags?: string[];
      }
    `);
    expect(result).toBe(
      [
        'import { z } from "zod";',
        "",
        "export const Pet = z.object({",
        "    name: z.string(),",
        "    age: z.int(),",
        "    tags: z.array(z.string()).optional()",
        "});",
        "",
      ].join("\n"),
    );
    const { Pet } = load(result);
    expect(Pet.parse({ name: "Rex", age: 3 })).toEqual({ name: "Rex", age: 3 });
    expect(() => Pet.parse({ name: "Rex", age: 3.5 })).toThrow();
  });

  it("emits model inheritance via extend", async () => {
    const result = await emit(`
      model Animal { kind: string; }
      model Dog extends Animal { breed: string; }
    `);
    expect(result).toContain("export const Dog = Animal.extend({");
    const { Dog } = load(result);
    expect(Dog.parse({ kind: "dog", breed: "lab" })).toEqual({ kind: "dog", breed: "lab" });
  });

  it("emits string enums as z.enum", async () => {
    const result = await emit(`
      enum Color { Red: "red", Blue: "blue" }
      enum Size { Small, Large }
    `);
    expect(result).toContain('export const Color = z.enum(["red", "blue"]);');
    expect(result).toContain('export const Size = z.enum(["Small", "Large"]);');
  });

  it("emits numeric enums as unions of literals", async () => {
    const result = await emit(`
      enum Priority { Low: 1, High: 2 }
    `);
    expect(result).toContain("export const Priority = z.union([z.literal(1), z.literal(2)]);");
  });

  it("resolves enum spread", async () => {
    const result = await emit(`
      enum Base { A: "a" }
      enum Ext { ...Base, B: "b" }
    `);
    expect(result).toContain('export const Ext = z.enum(["a", "b"]);');
  });

  it("references enum members as literals", async () => {
    const result = await emit(`
      enum Color { Red: "red", Blue: "blue" }
      model Paint { tone: Color.Red; }
    `);
    expect(result).toContain('tone: z.literal("red")');
  });

  it("emits named unions", async () => {
    const result = await emit(`
      union Result { ok: string, code: int32 }
    `);
    expect(result).toContain("export const Result = z.union([z.string(), z.int()]);");
  });

  it("handles anonymous models, unions and literals inline", async () => {
    const result = await emit(`
      model Widget {
        state: "on" | "off";
        nested: { deep: boolean };
        flag: true;
      }
    `);
    expect(result).toContain('state: z.union([z.literal("on"), z.literal("off")])');
    expect(result).toContain("nested: z.object({");
    expect(result).toContain("deep: z.boolean()");
    expect(result).toContain("flag: z.literal(true)");
  });

  it("maps well-known scalars", async () => {
    const result = await emit(`
      model Times {
        at: utcDateTime;
        day: plainDate;
        big: int64;
        blob: bytes;
        site: url;
        anything: unknown;
        nothing: null;
      }
    `);
    expect(result).toContain("at: z.iso.datetime()");
    expect(result).toContain("day: z.iso.date()");
    expect(result).toContain("big: z.bigint()");
    expect(result).toContain("blob: z.instanceof(Uint8Array)");
    expect(result).toContain("site: z.url()");
    expect(result).toContain("anything: z.unknown()");
    expect(result).toContain("nothing: z.null()");
    load(result);
  });

  it("declares custom scalars as schema aliases", async () => {
    const result = await emit(`
      scalar petId extends int32;
      scalar trackingId extends petId;
      model Pet { id: petId; tracking: trackingId; }
    `);
    expect(result).toContain("export const petId = z.int();");
    expect(result).toContain("export const trackingId = petId;");
    expect(result).toContain("id: petId");
  });

  it("emits Record and tuple types", async () => {
    const result = await emit(`
      model Bag {
        meta: Record<string>;
        pair: [string, int32];
      }
    `);
    expect(result).toContain("meta: z.record(z.string(), z.string())");
    expect(result).toContain("pair: z.tuple([z.string(), z.int()])");
    const { Bag } = load(result);
    expect(Bag.parse({ meta: { a: "b" }, pair: ["x", 1] })).toEqual({
      meta: { a: "b" },
      pair: ["x", 1],
    });
  });

  it("emits Record spreads as catchall", async () => {
    const result = await emit(`
      model Extra {
        name: string;
        ...Record<int32>;
      }
    `);
    expect(result).toContain("}).catchall(z.int());");
  });

  it("emits named array models", async () => {
    const result = await emit(`
      model Pet { name: string; }
      model Pets is Pet[];
    `);
    expect(result).toContain("export const Pets = z.array(Pet);");
  });

  it("orders declarations by dependency", async () => {
    const result = await emit(`
      model Owner { pet: Pet; }
      model Pet { name: string; }
    `);
    expect(result.indexOf("export const Pet")).toBeLessThan(result.indexOf("export const Owner"));
    load(result);
  });

  it("emits self-recursive models with getters", async () => {
    const result = await emit(`
      model Category {
        name: string;
        parent?: Category;
      }
    `);
    expect(result).toContain("get parent() { return Category.optional(); }");
    const { Category } = load(result);
    const value = { name: "a", parent: { name: "b" } };
    expect(Category.parse(value)).toEqual(value);
    expect(() => Category.parse({ name: "a", parent: { name: 1 } })).toThrow();
  });

  it("emits mutually recursive models", async () => {
    const result = await emit(`
      model A { b?: B; }
      model B { a?: A; }
    `);
    const { A } = load(result);
    const value = { b: { a: { b: {} } } };
    expect(A.parse(value)).toEqual(value);
  });

  it("skips template declarations and inlines instantiations", async () => {
    const result = await emit(`
      model Wrapper<T> { value: T; }
      model Box { wrapped: Wrapper<string>; }
    `);
    expect(result).not.toContain("Wrapper");
    expect(result).toContain("wrapped: z.object({");
    expect(result).toContain("value: z.string()");
  });

  it("skips operations and interfaces", async () => {
    const result = await emit(`
      model Pet { name: string; }
      op getPet(id: string): Pet;
      interface Pets { list(): Pet[]; }
    `);
    expect(result).not.toContain("getPet");
    expect(result).not.toContain("list");
  });

  it("maps constraint decorators to zod checks", async () => {
    const result = await emit(`
      model Pet {
        @minLength(1) @maxLength(50) name: string;
        @minValue(0) @maxValue(30) age: int32;
        @pattern("^[a-z]+$") slug: string;
        @minItems(1) tags: string[];
      }
    `);
    expect(result).toContain("name: z.string().min(1).max(50)");
    expect(result).toContain("age: z.int().min(0).max(30)");
    expect(result).toContain("slug: z.string().regex(/^[a-z]+$/)");
    expect(result).toContain("tags: z.array(z.string()).min(1)");
    const { Pet } = load(result);
    expect(() => Pet.parse({ name: "", age: 0, slug: "ok", tags: ["x"] })).toThrow();
    expect(() => Pet.parse({ name: "Rex", age: 0, slug: "NO", tags: ["x"] })).toThrow();
    expect(Pet.parse({ name: "Rex", age: 0, slug: "ok", tags: ["x"] })).toBeTruthy();
  });

  it("applies constraints on scalar declarations", async () => {
    const result = await emit(`
      @minValue(1)
      scalar positive extends int32;
      model M { n: positive; }
    `);
    expect(result).toContain("export const positive = z.int().min(1);");
  });

  it("emits bigint constraints as bigint literals", async () => {
    const result = await emit(`
      @minValue(1)
      scalar petId extends int64;
      model Pet { id: petId; }
    `);
    expect(result).toContain("export const petId = z.bigint().min(1n);");
    const { petId } = load(result);
    expect(petId.parse(5n)).toBe(5n);
    expect(() => petId.parse(0n)).toThrow();
  });

  it("emits string templates as z.templateLiteral", async () => {
    const result = await emit(`
      model Link { href: "https://\${string}/pets/\${int32}"; }
    `);
    expect(result).toContain(
      'href: z.templateLiteral(["https://", z.string(), "/pets/", z.int()])',
    );
    const { Link } = load(result);
    expect(Link.parse({ href: "https://x/pets/1" })).toBeTruthy();
    expect(() => Link.parse({ href: "https://x/pets/a" })).toThrow();
  });

  it("emits doc comments as JSDoc", async () => {
    const result = await emit(`
      /** A pet in the store. */
      model Pet {
        /** The pet's name. */
        name: string;
      }
    `);
    expect(result).toContain("/** A pet in the store. */");
    expect(result).toContain("    /** The pet's name. */");
  });

  it("overrides property schemas with @zodType", async () => {
    const result = await emit(`
      model User {
        @zodType("z.email()") mail: string;
      }
    `);
    expect(result).toContain("mail: z.email()");
    const { User } = load(result);
    expect(() => User.parse({ mail: "not-mail" })).toThrow();
  });

  it("adds imports for @zodType with a module", async () => {
    const result = await emit(`
      @zodType("moneySchema", "./money.js")
      scalar money extends float64;
      model Price { amount: money; }
    `);
    expect(result).toContain('import { moneySchema } from "./money.js";');
    expect(result).toContain("export const money = moneySchema;");
    expect(result).toContain("amount: money");
  });

  it("augments std scalars with @@zodType", async () => {
    const result = await emit(`
      @@zodType(utcDateTime, "z.date()");
      model Event { at: utcDateTime; }
    `);
    expect(result).toContain("at: z.date()");
  });

  it("quotes non-identifier property names", async () => {
    const result = await emit(`
      model Headers { \`content-type\`: string; }
    `);
    expect(result).toContain('"content-type": z.string()');
  });

  it("walks user namespaces but skips the TypeSpec stdlib", async () => {
    const result = await emit(`
      namespace My.Service;
      model Thing { id: string; }
    `);
    expect(result).toContain("export const Thing = z.object({");
    expect(result).not.toContain("ServiceOptions");
  });

  it("references types from nested namespaces", async () => {
    const result = await emit(`
      namespace A.B;
      model Inner { x: string; }
      model Outer { inner: Inner; }
    `);
    expect(result).toContain("inner: Inner");
    expect(result.indexOf("export const Inner")).toBeLessThan(result.indexOf("export const Outer"));
  });

  it("references enums used as property types", async () => {
    const result = await emit(`
      enum Color { Red: "red", Blue: "blue" }
      model Paint { color: Color; }
    `);
    expect(result).toContain('export const Color = z.enum(["red", "blue"]);');
    expect(result).toContain("color: Color");
  });

  it("emits scalars without a base as z.unknown", async () => {
    const result = await emit(`
      scalar mystery;
      model M { x: mystery; }
    `);
    expect(result).toContain("export const mystery = z.unknown();");
    expect(result).toContain("x: mystery");
  });

  it("inlines generic array aliases", async () => {
    const result = await emit(`
      model List<T> is T[];
      model Box { items: List<string>; }
    `);
    expect(result).not.toContain("export const List");
    expect(result).toContain("items: z.array(z.string())");
  });

  it("inlines generic record aliases", async () => {
    const result = await emit(`
      model Dict<T> is Record<T>;
      model Box { data: Dict<int32>; }
    `);
    expect(result).not.toContain("export const Dict");
    expect(result).toContain("data: z.record(z.string(), z.int())");
  });

  it("wraps recursive declarations in z.lazy", async () => {
    const result = await emit(`
      union Json {
        str: string,
        arr: Json[],
      }
    `);
    expect(result).toContain("export const Json = z.lazy(() =>");
    const { Json } = load(result);
    const value = ["a", ["b", []]];
    expect(Json.parse(value)).toEqual(value);
    expect(Json.parse("leaf")).toBe("leaf");
  });

  it("emits never as z.never", async () => {
    const result = await emit(`
      model M { n: never; }
    `);
    expect(result).toContain("n: z.never()");
  });

  it("collapses constant string templates to literals", async () => {
    const result = await emit(`
      alias Host = "host";
      model M { s: "https://\${Host}/v1"; }
    `);
    expect(result).toContain('s: z.literal("https://host/v1")');
  });
});
