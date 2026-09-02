import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules", "dist", "**/scripts/check-cors.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    setupFiles: ["./test/setup-env.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Single thread so the testcontainer is shared across files.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Ratchet target.
      //
      // For this first PR we only have a few helpers and one route
      // (login) under test, so the include list is narrow and the
      // threshold is low. As more routes are tested in subsequent PRs
      // (signup, OTP verify, storage, analysis), expand the include
      // list and ratchet the threshold.
      //
      // Tip: if a file you add shows <threshold% in CI, write tests for
      // it before merging rather than lowering the bar.
      include: [
        "src/lib/security.ts",
        "src/lib/db-bootstrap.ts",
        "src/routes/auth.ts",
      ],
      thresholds: {
        // Ratcheted after slice 2 (signup + OTP + 2FA + me = 18 more tests).
        // Bump per slice as we add storage + analysis coverage.
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  },
});