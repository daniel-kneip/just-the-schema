import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig([
  { ignores: ["dist", "coverage", "**/tsp-output/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      complexity: ["error", 12],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 3],
    },
  },
  // Keep last: turns off rules that conflict with Prettier formatting.
  eslintConfigPrettier,
]);
