import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { AppThemeProvider } from "./components/theme-provider";
import { SoundProvider } from "./components/sound-provider";
import { LiveRegionProvider } from "./components/live-region";
import { installCsrfFetch } from "./lib/csrf";
import { installGlobalHandlers } from "./lib/crash-reporter";

// Attach the CSRF token on mutating /api requests (required by the edge Worker).
installCsrfFetch();
// Catch unhandled errors and report them (see crash-reporter.ts).
installGlobalHandlers();

createRoot(document.getElementById("root")!).render(
  <AppThemeProvider>
    <LiveRegionProvider>
      <SoundProvider>
        <App />
      </SoundProvider>
    </LiveRegionProvider>
  </AppThemeProvider>,
);
