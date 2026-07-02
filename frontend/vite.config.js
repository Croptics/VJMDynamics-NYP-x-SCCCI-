import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies any /api request to the Express backend on :4000.
// This means the React code just calls fetch("/api/...") — no CORS, no origin
// juggling. Change the target if you run the backend on a different port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
