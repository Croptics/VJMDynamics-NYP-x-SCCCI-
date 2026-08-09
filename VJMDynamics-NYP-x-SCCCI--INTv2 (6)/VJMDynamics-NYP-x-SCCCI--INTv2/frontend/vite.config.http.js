/* Plain-HTTP dev server — same as vite.config.js minus basicSsl(), on port 5175.
 *
 * Why it exists: the in-app browser pane (Claude Code's preview) refuses the
 * self-signed certificate that the main dev server uses, so it can't open
 * https://localhost:5173 at all. http://localhost is still a "secure context"
 * per the browser spec, so the camera (getUserMedia) and password/passkey APIs
 * keep working here — the HTTPS cert in vite.config.js is only needed for
 * reaching the dev server from a phone over the LAN, which this config isn't
 * for. Run with:  npm run dev --prefix frontend -- --config vite.config.http.js
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    fs: { allow: [".."] },
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true } },
  },
});
