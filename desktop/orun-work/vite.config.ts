import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the dev build from a fixed port and reads `dist` for release.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", outDir: "dist", sourcemap: false },
});
