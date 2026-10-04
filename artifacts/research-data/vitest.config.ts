import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Use the automatic JSX runtime so components don't need to import React.
  esbuild: { loader: "tsx", jsx: "automatic", jsxImportSource: "react" },
  test: {
    globals: true,
    environment: "jsdom",
    // Single runner for the whole suite. This used to be narrowed to
    // `tests/**/*-vitest.test.ts{,x}`, which silently skipped every plain
    // `.test.ts` file (7 files, including desktop-mode.test.ts) even though
    // `pnpm test` handed them to `node --test`.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/vitest.setup.tsx"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      // Playwright specs are not vitest tests.
      "tests/a11y-pages/**",
    ],
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
