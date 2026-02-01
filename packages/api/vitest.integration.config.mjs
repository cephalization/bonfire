import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".integration/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
