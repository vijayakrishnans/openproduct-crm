import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import createHtmlPlugin from "vite-plugin-simple-html";

// The public demo build: the whole CRM runs in the browser on the fakerest
// provider (demo/App.tsx), with generated, fake data and no backend. Ported
// from Atomic CRM's vite.demo.config.ts; the bundle visualiser is dropped.
export default defineConfig({
  server: {
    port: 5174,
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    createHtmlPlugin({
      minify: true,
      inject: {
        data: {
          mainScript: `demo/main.tsx`,
        },
      },
    }),
  ],
  define: {
    "import.meta.env.VITE_IS_DEMO": JSON.stringify("true"),
    // The demo never reaches a backend. These placeholders only satisfy code
    // paths that read them at import time; M3 replaces Supabase entirely.
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://demo.example.org"),
    "import.meta.env.VITE_SB_PUBLISHABLE_KEY": JSON.stringify("demo"),
  },
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
