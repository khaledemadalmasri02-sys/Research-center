// ESLint 9 flat config.
//
// Targets the actual toolchain: React 19 + TS 5.9 + Vite 7 on Node 22.
//
// Two source blocks, because the two halves of this repo have genuinely
// different runtimes and globals:
//   * browser/React — artifacts/research-data, artifacts/mockup-sandbox
//   * node/server  — artifacts/api-server, research, lib/*, scripts
//
// Plus a relaxed block for test globs (`*.test.*`, `*.spec.*`, `test/`,
// `tests/`) where `any` and bare expressions are normal.

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const BROWSER_GLOBS = [
  "artifacts/research-data/**/*.{ts,tsx}",
  "artifacts/mockup-sandbox/**/*.{ts,tsx}",
];

const NODE_GLOBS = [
  "artifacts/api-server/**/*.{ts,tsx}",
  "artifacts/local-api/**/*.{ts,tsx}",
  "research/src/**/*.{ts,tsx}",
  "research/test/**/*.{ts,tsx}",
  "lib/**/src/**/*.{ts,tsx}",
  "scripts/src/**/*.{ts,tsx}",
];

const TEST_GLOBS = [
  "**/test/**/*.{ts,tsx}",
  "**/tests/**/*.{ts,tsx}",
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
];

// Builds, vendored assets, generated clients and dead trees.
const IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-dryrun/**",
  "**/build/**",
  "**/coverage/**",
  "**/.wrangler/**",
  "**/playwright-report/**",
  "**/test-results/**",
  "artifacts/research-data/public/**",
  "research/public/**",
  "research/public-legacy/**",
  // Deleted deprecated parallel SPA (see the C9 cleanup).
  "research/ui/**",
  "lib/api-client-react/src/generated/**",
  ".kilo/**",
  ".playwright-mcp/**",
  "attached_assets/**",
  "branding/**",
];

// The TypeScript-aware base: parser + plugin registration + `recommended`.
const tsBase = tseslint.configs.recommended;

const sharedRules = {
  eqeqeq: ["error", "smart"],
  "prefer-const": "error",
  "no-var": "error",
  "object-shorthand": "error",
  // `tsc` reports unused identifiers with the real type information; the
  // base config's `no-unused-vars` does not understand type-only imports.
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "no-undef": "off",
};

export default tseslint.config(
  { ignores: IGNORES },

  // Plain JS/TS config files at the repo root (vite/vitest/playwright/eslint).
  js.configs.recommended,
  tsBase,
  {
    // Pre-existing `// eslint-disable-next-line` comments in this repo target
    // rules that are not enabled in these blocks (e.g. `no-console` in a
    // browser file), so ESLint 9's default "warn on unused directive" only
    // produces noise that no one can act on.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
        // Required by `tests/vitest.setup.ts`, which uses JSX inside a `.ts`
        // file (vitest is configured with `esbuild.loader: "tsx"` for exactly
        // that reason).
        ecmaFeatures: { jsx: true },
      },
    },
    rules: sharedRules,
  },

  // ---- browser / React ----------------------------------------------------
  {
    files: BROWSER_GLOBS,
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...sharedRules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // ---- node / server ------------------------------------------------------
  {
    files: NODE_GLOBS,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      ...sharedRules,
      "no-console": "off",
    },
  },

  // ---- tests --------------------------------------------------------------
  {
    // Fixtures and partially-mocked modules are `any` by nature, and assertion
    // helpers are built out of bare expressions.
    files: TEST_GLOBS,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-expressions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // ---- config files -------------------------------------------------------
  {
    files: ["**/*.config.{js,ts,mjs,cjs}", "**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },
);
