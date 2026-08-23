import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Build output goes to the worker's `public/` directory so Cloudflare Assets
// serves the SPA unchanged (wrangler.toml already sets
// not_found_handling = "single-page-application" and run_worker_first=["/api/*"]).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("../public", import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 5173 },
});
