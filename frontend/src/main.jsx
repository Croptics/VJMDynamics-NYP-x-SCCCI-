/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — app entry & providers
 * ============================================================================= */
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css"; // imported before App so component-scoped stylesheets (e.g. mobile.css) can safely override it in the cascade
import App from "./App.jsx";
import { LanguageProvider } from "./lib/i18n.jsx";
import { ThemeProvider } from "./lib/theme.jsx";

// future flags (2026-08-05): react-router 6.23 logs a console warning for each
// v7 behaviour you haven't opted into. Opting in now silences the noise AND
// makes the v7 upgrade a non-event:
//   v7_startTransition   — route state updates wrapped in React.startTransition
//   v7_relativeSplatPath — v7's relative-path resolution inside splat routes
// Neither changes anything this app relies on. Checked rather than assumed:
// App.jsx has two `path="*"` routes, but both render <Navigate> to an ABSOLUTE
// path ("/login" and pickHomeRoute()), and v7_relativeSplatPath only alters how
// RELATIVE paths resolve inside a splat — so it's a no-op here. Nothing depends
// on route updates being synchronous either.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
