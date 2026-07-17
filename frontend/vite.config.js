import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies any /api request to the Express backend on :4000.
// This means the React code just calls fetch("/api/...") — no CORS, no origin
// juggling. Change the target if you run the backend on a different port.
//
// `server.fs.allow: ['..']` lets the dev server read one folder above the
// frontend (the project root), so the shared ../../../permissions.js file that
// both the frontend and backend import can be served in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Without this, Vite silently falls back to the next free port (5174,
    // 5175...) if 5173 is already taken (e.g. a leftover dev-server process
    // from a previous run that didn't exit cleanly — this happens often on
    // this project). That's dangerous here because saved browser state is
    // scoped per-origin INCLUDING the port: Chrome's "remember password"
    // autofill, localStorage sessions, etc. all silently stop matching the
    // moment the server drifts to a different port, with no visible error —
    // it just looks like "remember password doesn't work". Failing loudly
    // instead makes a stale process obvious so it gets killed, not routed
    // around.
    strictPort: true,
    host: true,
    fs: {
      allow: [".."],
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
