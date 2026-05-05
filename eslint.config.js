// ESLint flat config. Keeps lint scope narrow for now: TypeScript
// recommended rules plus a few stylistic guards. Test type-check files
// (*.test-d.ts) are linted but `@ts-expect-error` is allowed since their
// whole purpose is asserting that code fails to type-check.

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test-d.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
