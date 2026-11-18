import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import createHtmlPlugin from "vite-plugin-simple-html";

// One build serves both apps (src/main.tsx): the CRM on the Lumen API, and
// with `?demo` the in-browser demo on the fakerest provider (demo/App.tsx),
// with generated, fake data and no backend. Ported from Atomic CRM's Vite
// configs; the bundle visualiser is dropped.
export default defineConfig({
  server: {
    port: 5174,
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    createHtmlPlugin({
      // Not minified: the minifier drops the space between a word and a link,
      // which the landing page text in index.html depends on.
      minify: false,
      inject: {
        data: {
          mainScript: `src/main.tsx`,
        },
      },
    }),
  ],
  base: "./",
  build: {
    rolldownOptions: {
      output: {
        keepNames: true,
      },
    },
    sourcemap: true,
  },
  resolve: {
    dedupe: ["react-router", "react-router-dom"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
