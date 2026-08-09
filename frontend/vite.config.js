import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// The dev server proxies any /api request to the Express backend on :4000.
// This means the React code just calls fetch("/api/...") — no CORS, no origin
// juggling. Change the target if you run the backend on a different port.
//
// basicSsl() serves the dev site over HTTPS with an auto-generated self-signed
// cert. WHY THIS IS REQUIRED (not cosmetic): the camera (getUserMedia) and the
// browser's password-save/autofill (Credential Management API) ONLY work in a
// "secure context" — https://, or http://localhost. On a phone reaching the
// dev server over the LAN as http://192.168.1.11:5173 (plain HTTP, not
// localhost), BOTH are silently blocked in every browser (Chrome, Brave, …) —
// which is exactly why the on-phone scanner showed "Camera unavailable" and
// passwords never offered to save. With HTTPS the phone hits
// https://192.168.1.11:5173 (accept the one-time self-signed-cert warning:
// "Advanced" → "Proceed") and the camera + password save both work. On the
// laptop, localhost was already a secure context, so nothing there changes
// except the scheme (https://localhost:5173).
export default defineConfig({
  plugins: [react(), basicSsl()],
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
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
