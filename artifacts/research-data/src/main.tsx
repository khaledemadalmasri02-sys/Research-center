import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { AppThemeProvider } from "./components/theme-provider";
import { SoundProvider } from "./components/sound-provider";
import { LiveRegionProvider } from "./components/live-region";
import { ThemePresetProvider } from "./components/desktop/theme-preset-context";
import { installCsrfFetch } from "./lib/csrf";
import { installGlobalHandlers } from "./lib/crash-reporter";
import { installSessionExpiryWatch } from "./hooks/use-auth";

// Attach the CSRF token on mutating /api requests (required by the edge Worker).
installCsrfFetch();
// Catch unhandled errors and report them (see crash-reporter.ts).
installGlobalHandlers();
// Observe 401s on any non-/api/auth/me request plus a periodic /api/auth/me
// poll, so an expired session surfaces as an explicit prompt instead of stale
// cached PHI. MUST be called here: the hook lives below <App /> and exporting it
// without installing it leaves the watchdog completely inert.
installSessionExpiryWatch();

// Provider order matters:
//   AppThemeProvider   -> next-themes; ThemePresetProvider calls useTheme()
//   ThemePresetProvider -> publishes --primary/--ring/--accent-* for BOTH
//                          shells and resolves the persisted desktop preset.
//                          MUST stay inside AppThemeProvider.
//   LiveRegionProvider  -> one polite/assertive region for the whole document.
//   SoundProvider       -> one WebAudio graph + key-shortcut handler.
// All three used to live below <App /> (or, for the preset provider, inside the
// desktop shell only), so the classic shell never received the preset tokens
// and both shells could end up with duplicate live regions / audio graphs.
createRoot(document.getElementById("root")!).render(
  <AppThemeProvider>
    <ThemePresetProvider>
      <LiveRegionProvider>
        <SoundProvider>
          <App />
        </SoundProvider>
      </LiveRegionProvider>
    </ThemePresetProvider>
  </AppThemeProvider>,
);
