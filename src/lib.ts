import { createTypeSpecLibrary } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name: "just-the-schema",
  diagnostics: {},
  state: {
    zodType: { description: "Raw Zod expression overrides with optional import source" },
  },
});
