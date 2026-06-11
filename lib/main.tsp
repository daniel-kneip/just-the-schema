import "../dist/index.js";

using TypeSpec.Reflection;

namespace JustTheSchema;

/**
 * Replace the emitted schema with a raw Zod expression.
 * @param type Zod expression text, e.g. "z.email()" or "moneySchema".
 * @param importFrom Optional module to import the expression's root identifier from.
 */
extern dec zodType(target: Scalar | ModelProperty, type: valueof string, importFrom?: valueof string);
