import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.worktrees/**", "coverage/**", "tmp/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
  prettier,
];
