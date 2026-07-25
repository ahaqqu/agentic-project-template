import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.{test,prop.test}.ts",
      "apps/**/src/**/*.{test,prop.test}.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/*/src/**/*.ts",
        "apps/api/src/**/*.ts",
        "apps/web/src/lib/**/*.ts",
      ],
      exclude: [
        "**/*.{test,prop.test}.ts",
        "**/index.ts",
        "**/*.d.ts",
        "apps/api/src/index.ts",
        "packages/db-schema/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
