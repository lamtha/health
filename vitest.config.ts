import path from "node:path";
import { defineConfig } from "vitest/config";

const root = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          include: ["tests/api/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./tests/setup-data-dir.ts"],
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: "smoke",
          include: ["tests/smoke/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./tests/setup-data-dir.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          maxWorkers: 1,
        },
      },
    ],
  },
});
