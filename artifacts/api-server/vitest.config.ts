import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules", "dist", "**/scripts/check-cors.ts"],
    testTimeout: 10_000,
  },
});