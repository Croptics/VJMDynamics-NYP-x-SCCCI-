import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css"; // imported before App so component-scoped stylesheets (e.g. mobile.css) can safely override it in the cascade
import App from "./App.jsx";
import { LanguageProvider } from "./lib/i18n.jsx";
import { ThemeProvider } from "./lib/theme.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
