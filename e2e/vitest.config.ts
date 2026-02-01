import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    reporters: "default",
  },
  resolve: {
    alias: {
      "@bonfire/sdk": path.resolve(__dirname, "../packages/sdk/src/index.ts"),
    },
  },
});
