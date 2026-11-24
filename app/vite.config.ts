import { defineConfig } from "vite";

// Relativer Pfad, damit die gebaute Seite auch in einem Unterordner einer Webseite läuft.
export default defineConfig({
  base: "./",
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist", chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
  test: { environment: "node" },
} as any);
