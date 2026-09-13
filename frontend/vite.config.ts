/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            /node_modules\/(react|react-dom|scheduler)\//.test(id) ||
            /node_modules\/(react-router|react-router-dom|@remix-run)\//.test(id) ||
            /node_modules\/@tanstack\//.test(id)
          ) {
            return "react-vendor";
          }
          if (/node_modules\/axios\//.test(id)) {
            return "http";
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    globals: true,
    testTimeout: 30000,
  },
});
