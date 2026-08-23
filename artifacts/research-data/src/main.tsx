import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { AppThemeProvider } from "./components/theme-provider";
import { installCsrfFetch } from "./lib/csrf";

// Attach the CSRF token on mutating /api requests (required by the edge Worker).
installCsrfFetch();

createRoot(document.getElementById("root")!).render(
  <AppThemeProvider>
    <App />
  </AppThemeProvider>,
);
