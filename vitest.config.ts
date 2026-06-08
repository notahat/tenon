// Vitest config defining two projects.
//
//   - "unit": fast, pure-TS tests under test/unit, including type-level
//     tests in *.test-d.ts files. Always runs.
//   - "integration": tests under test/integration that connect to a real
//     PostgreSQL via DATABASE_URL. Skipped (excluded) when DATABASE_URL
//     is not set, so a missing local database does not break `npm test`.

import { defineConfig } from "vitest/config";

const hasDatabaseUrl = Boolean(process.env["DATABASE_URL"]);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          typecheck: {
            enabled: true,
            include: ["test/unit/**/*.test-d.ts"],
          },
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          ...(hasDatabaseUrl ? {} : { exclude: ["**/*"] }),
        },
      },
    ],
  },
});
