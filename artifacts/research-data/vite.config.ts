import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "replace-unicode-chars",
      generateBundle(options, bundle) {
        // Skip third-party library chunks (e.g. SheetJS) whose source legitimately
        // contains smart-quote characters. Replacing them there corrupts the bundle
        // (e.g. xlsx.js fails to parse as a module).
        const vendorChunks = /(^|\/|\b)(xlsx|exceljs|jszip|xlsx\.full|sheetjs)[-.]?.*\.js$/i;
        for (const fileName in bundle) {
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk" && typeof chunk.code === "string" && !vendorChunks.test(fileName)) {
            chunk.code = chunk.code.replace(/[\u2018\u2019\u201C\u201D]/g, (match: string) => {
              const map: Record<string, string> = {
                "\u2018": "'",
                "\u2019": "'",
                "\u201C": '"',
                "\u201D": '"',
              };
              return map[match] || match;
            });
          }
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  server: {
    port: 3004,
    host: "0.0.0.0",
    allowedHosts: true,
    // In local/self-hosted dev the API server runs on a different port than the
    // Vite dev server, so proxy /api there. On hosted platforms that route /api
    // to the API server via a path-based proxy, leave this unset.
    ...(process.env.API_PROXY_TARGET
      ? {
          proxy: {
            "/api": {
              target: process.env.API_PROXY_TARGET,
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
});
