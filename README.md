# just-the-schema

Emitter to create [Zod](https://zod.dev) schemas from TypeSpec. No clients, no
serializers — just the schemas, emitted as plain readable code. Sibling of
[just-the-type](https://github.com/daniel-kneip/just-the-type).

## Usage

```sh
pnpm add just-the-schema
tsp compile . --emit just-the-schema
```

The emitter writes a single `schemas.ts` to `tsp-output/just-the-schema/`.
The emitted code requires `zod` >= 4 in the consuming project.

## What gets emitted

| TypeSpec                                 | Zod                                              |
| ---------------------------------------- | ------------------------------------------------ |
| `model`                                  | `export const X = z.object({...})`               |
| `model X extends Y`                      | `Y.extend({...})`                                |
| `model Pets is Pet[]`                    | `z.array(Pet)`                                   |
| `...Record<T>` spread                    | `.catchall(T)`                                   |
| `Record<T>`                              | `z.record(z.string(), T)`                        |
| `enum` (string values, incl. spread)     | `z.enum([...])`                                  |
| `enum` (numeric/mixed values)            | `z.union([z.literal(...), ...])`                 |
| named `union`                            | `z.union([...])`                                 |
| custom `scalar`                          | `export const` alias to its base schema          |
| recursive models                         | Zod getter idiom (`get prop() { return X; }`)    |
| tuples                                   | `z.tuple([...])`                                 |
| literals                                 | `z.literal(...)`                                 |
| string templates `"a-${string}"`         | `z.templateLiteral([...])`                       |
| optional properties                      | `.optional()`                                    |
| doc comments / `@doc`                    | JSDoc comments                                   |
| anonymous models, unions, intersections  | inlined structurally                             |
| templates                                | declaration skipped, instantiations inlined      |
| `int64` / `uint64`                       | `z.bigint()`                                     |
| integer types                            | `z.int()`                                        |
| other numerics                           | `z.number()`                                     |
| `bytes`                                  | `z.instanceof(Uint8Array)`                       |
| `url`                                    | `z.url()`                                        |
| dates, times, `duration`                 | `z.iso.date()` / `z.iso.datetime()` / ...        |

Declarations are emitted in dependency order, so plain references work without
`z.lazy` except for true cycles.

### Constraints

Built-in TypeSpec constraint decorators become Zod checks — the reason to emit
schemas instead of plain types:

| TypeSpec                       | Zod                  |
| ------------------------------ | -------------------- |
| `@minLength` / `@maxLength`    | `.min()` / `.max()`  |
| `@minValue` / `@maxValue`      | `.min()` / `.max()`  |
| `@minItems` / `@maxItems`      | `.min()` / `.max()`  |
| `@pattern`                     | `.regex(/.../)`      |

Not represented in the output: `op` and `interface` declarations (schemas
describe data, not functions), `alias` declarations (dissolved by the TypeSpec
checker), values/`const`, and default values.

## Decorators

The library ships one decorator. Import the library and bring it into scope:

```typespec
import "just-the-schema";
using JustTheSchema;
```

| Decorator                            | Target             | Effect                                                  |
| ------------------------------------ | ------------------ | ------------------------------------------------------- |
| `@zodType("z.email()")`              | `scalar`, property | Replaces the emitted schema with a raw Zod expression   |
| `@zodType("moneySchema", "./money.js")` | `scalar`, property | Same, plus `import { moneySchema } from "./money.js";` |

`@zodType` also works on built-in scalars via augment decorators, e.g. validate
all `utcDateTime` as real `Date` objects:

```typespec
@@zodType(utcDateTime, "z.date()");
```

## Development

```sh
pnpm install
pnpm test        # vitest
pnpm build       # tsc -> dist/
```

Try it on the sample:

```sh
pnpm sample    # tsp compile sample -> sample/tsp-output/
```

## License

[MIT](LICENSE)
