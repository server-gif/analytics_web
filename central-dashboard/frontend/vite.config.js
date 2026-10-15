import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev: frontend :5173, backend worker :8787. /api proxy thathi ne
// frontend ma koi Worker URL hardcode karvano thayo nahi (same-origin rako).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist" },
});