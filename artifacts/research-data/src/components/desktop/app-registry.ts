import { lazy, type LazyExoticComponent, type ComponentType } from "react";
import { APP_SVG_ICONS } from "./app-icons";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  FileText,
  BarChart3,
  MessageSquare,
  LayoutGrid,
  Database as DatabaseIcon,
  ShieldAlert,
  Activity as ActivityIcon,
  History,
  KeyRound,
  Monitor,
  FileCheck,
  ShieldCheck,
  Code2,
  ListChecks,
  ScanLine,
  Download,
  BookOpen,
  Brain,
  FileBarChart,
  ScrollText,
  UploadCloud,
  Search,
  List,
  Pencil,
  Settings as SettingsIcon,
  Palette,
  Table,
  Box,
} from "lucide-react";

export interface AppLoaderProps {
  // The wouter-style route the app was opened with (e.g. "/patients/133").
  // Apps that read `useParams()` fall back to parsing this when no <Route>
  // matches (the desktop shell does not mount the classic wouter routes).
  route?: string;
  // The desktop window id this loader is mounted in. Apps use this with
  // `useDesktop().setRoute(id, ...)` to navigate within the same window.
  windowId?: string;
}

export interface AppDef {
  id: string;
  titleKey: string;
  icon: typeof LayoutDashboard;
  loader: LazyExoticComponent<ComponentType<AppLoaderProps>>;
  defaultSize?: { w: number; h: number };
  singleton?: boolean;
  adminOnly?: boolean;
  category?: string;
  showInDock?: boolean;
  /**
   * Whether the app may be spawned from the app-launcher grid.
   *
   * Parameterised apps (`records/:definitionId`, `patient-view`, …) are `false`
   * by default: they are only meaningful with a concrete `route`/resource id,
   * and the launcher opens them with none. `useParams()` then returns `{}`
   * (the desktop shell mounts no wouter `<Route>` for the loader), so e.g.
   * `record-list` computes `Number(undefined) === NaN` and renders an empty
   * window. Set `showInLauncher: true` only for apps that render correctly
   * without a route.
   */
  showInLauncher?: boolean;
  iconSvg?: ComponentType<{ className?: string }>;
}

  /* REMOVED 2026-10: the `data-table-demo` app entry and its lazy import are gone.
     The page synthesises 2,000 fake patients in-browser as a harness for the
     virtualized DataTable. It was already unrouted in the classic shell, so on the
     apex host it was reachable only through the launcher — i.e. a fabricated patient
     roster sitting one click from a real clinical UI, indistinguishable from live
     data. With both entries removed the page is unreachable and can be deleted.
     Reinstate here (and re-add the Route in App.tsx) if the table work needs a
     fixture again. */
export const Home = lazy(() => import("@/pages/home"));
export const Patients = lazy(() => import("@/pages/patients"));
export const PatientCorridor = lazy(() => import("@/pages/patient-corridor"));
export const PatientWorkspace = lazy(() => import("@/pages/patient-workspace"));
export const Login = lazy(() => import("@/pages/login"));
export const Signup = lazy(() => import("@/pages/signup"));
// Password recovery. Both are PUBLIC routes: `/reset-password?token=…` is
// followed from an email link by someone who is, by definition, signed out, so
// they must sit in the unauthenticated branch of `ProtectedRoutes` — not in the
// authenticated shell.
export const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
export const ResetPassword = lazy(() => import("@/pages/reset-password"));
export const Welcome = lazy(() => import("@/pages/welcome"));
export const Database = lazy(() => import("@/pages/database"));
export const Admin = lazy(() => import("@/pages/admin"));
export const Collections = lazy(() => import("@/pages/records"));
export const RecordDefinitionEdit = lazy(() => import("@/pages/record-definition-edit"));
export const RecordList = lazy(() => import("@/pages/record-list"));
export const RecordDetail = lazy(() => import("@/pages/record-detail"));
export const PatientRecordView = lazy(() => import("@/pages/patient-record-view"));
export const PatientRecordFormPage = lazy(() => import("@/components/patient-record-form"));
export const NewRecordPage = lazy(() => import("@/components/new-record-page"));
export const Feedback = lazy(() => import("@/pages/feedback"));
export const Activity = lazy(() => import("@/pages/activity"));
export const ActivityMe = lazy(() => import("@/pages/activity-me"));
export const ApiTokens = lazy(() => import("@/pages/api-tokens"));
export const Sessions = lazy(() => import("@/pages/sessions"));
export const NotFound = lazy(() => import("@/pages/not-found"));
export const MoreFeatures = lazy(() => import("@/pages/more-features"));
export const Consent = lazy(() => import("@/pages/consent"));
export const Deidentify = lazy(() => import("@/pages/deidentify"));
export const Coding = lazy(() => import("@/pages/coding"));
export const Cohort = lazy(() => import("@/pages/cohort"));
export const ValidationPage = lazy(() => import("@/pages/validation"));
export const Dicom = lazy(() => import("@/pages/dicom"));
export const ExportPage = lazy(() => import("@/pages/export"));
export const Studies = lazy(() => import("@/pages/studies"));
export const Ml = lazy(() => import("@/pages/ml"));
export const Reports = lazy(() => import("@/pages/reports"));
export const Gdpr = lazy(() => import("@/pages/gdpr"));
export const Ingest = lazy(() => import("@/pages/ingest"));
export const SearchPage = lazy(() => import("@/pages/search"));
export const DataAnalysis = lazy(() => import("@/pages/data-analysis"));
export const Settings = lazy(() => import("@/pages/settings"));
export const ThemeManager = lazy(() => import("@/pages/theme-manager"));

export const DEFAULT_WINDOW_SIZE = { w: 980, h: 660 };

// Catalog of every "app" available in the Ubuntu desktop shell. Reused by the
// dock, the app launcher, and the window manager.
//
// `titleKey` MUST be a fully-qualified key that resolves to a leaf string.
// Bare keys such as `"patients"` only exist under `nav.*`; i18next is
// configured without `saveMissing`, so an unprefixed key renders literally as
// "patients" in the dock, the launcher and every window title — in English and
// in Arabic alike. Prefer an existing key over adding a new one.
export const APPS: AppDef[] = ([
  { id: "home", titleKey: "nav.dashboard", icon: LayoutDashboard, loader: Home, singleton: true, showInDock: true, category: "main" },
  { id: "patients", titleKey: "nav.patients", icon: Users, loader: Patients, singleton: true, showInDock: true, category: "main" },
  { id: "patient-corridor", titleKey: "app.patientCorridor", icon: Box, loader: PatientCorridor, singleton: true, showInDock: true, category: "main", defaultSize: { w: 1280, h: 760 } },
  { id: "patient-workspace", titleKey: "app.patientWorkspace", icon: Box, loader: PatientWorkspace, singleton: false, showInDock: true, category: "main", defaultSize: { w: 1320, h: 820 } },
  { id: "patients/new", titleKey: "nav.newPatient", icon: UserPlus, loader: NewRecordPage, singleton: false, showInDock: false, category: "main" },
  { id: "collections", titleKey: "nav.collections", icon: FileText, loader: Collections, singleton: true, showInDock: true, category: "main" },
  { id: "data-analysis", titleKey: "nav.dataAnalysis", icon: BarChart3, loader: DataAnalysis, singleton: true, showInDock: true, category: "main" },
  { id: "feedback", titleKey: "nav.feedback", icon: MessageSquare, loader: Feedback, singleton: true, showInDock: true, category: "main" },
  { id: "more-features", titleKey: "nav.moreFeatures", icon: LayoutGrid, loader: MoreFeatures, singleton: true, showInDock: true, category: "main" },
  { id: "database", titleKey: "nav.database", icon: DatabaseIcon, loader: Database, singleton: true, adminOnly: true, showInDock: false, category: "admin" },
  { id: "admin", titleKey: "nav.admin", icon: ShieldAlert, loader: Admin, singleton: true, adminOnly: true, showInDock: false, category: "admin" },
  { id: "activity", titleKey: "nav.activity", icon: ActivityIcon, loader: Activity, singleton: true, adminOnly: true, showInDock: false, category: "admin" },
  { id: "activity/me", titleKey: "nav.myActivity", icon: History, loader: ActivityMe, singleton: true, showInDock: false, category: "utility" },
  { id: "api-tokens", titleKey: "nav.apiTokens", icon: KeyRound, loader: ApiTokens, singleton: true, showInDock: false, category: "utility" },
  { id: "sessions", titleKey: "nav.sessions", icon: Monitor, loader: Sessions, singleton: true, showInDock: false, category: "utility" },
  { id: "settings", titleKey: "nav.settings", icon: SettingsIcon, loader: Settings, singleton: true, category: "utility" },
  { id: "theme-manager", titleKey: "nav.themeManager", icon: Palette, loader: ThemeManager, singleton: true, showInDock: true, category: "utility" },
  { id: "consent", titleKey: "app.consent", icon: FileCheck, loader: Consent, singleton: true, category: "tools" },
  { id: "deidentify", titleKey: "app.deidentify", icon: ShieldCheck, loader: Deidentify, singleton: true, category: "tools" },
  { id: "coding", titleKey: "app.coding", icon: Code2, loader: Coding, singleton: true, category: "tools" },
  { id: "cohort", titleKey: "app.cohort", icon: Users, loader: Cohort, singleton: true, category: "tools" },
  { id: "validation", titleKey: "app.validation", icon: ListChecks, loader: ValidationPage, singleton: true, category: "tools" },
  { id: "dicom", titleKey: "app.dicom", icon: ScanLine, loader: Dicom, singleton: true, category: "tools" },
  { id: "export", titleKey: "app.export", icon: Download, loader: ExportPage, singleton: true, category: "tools" },
  { id: "studies", titleKey: "app.studies", icon: BookOpen, loader: Studies, singleton: true, category: "tools" },
  { id: "ml", titleKey: "app.ml", icon: Brain, loader: Ml, singleton: true, category: "tools" },
  { id: "reports", titleKey: "app.reports", icon: FileBarChart, loader: Reports, singleton: true, category: "tools" },
  { id: "gdpr", titleKey: "app.gdpr", icon: ScrollText, loader: Gdpr, singleton: true, category: "tools" },
  { id: "ingest", titleKey: "app.ingest", icon: UploadCloud, loader: Ingest, singleton: true, category: "tools" },
  { id: "search", titleKey: "app.search", icon: Search, loader: SearchPage, singleton: true, category: "tools" },
  // --- record-scoped apps -------------------------------------------------
  // Every entry below is parameterised: it needs a concrete `route` to resolve
  // `useParams()`, so none of them may be spawned from the launcher grid.
  { id: "records/:definitionId", titleKey: "app.records", icon: List, loader: RecordList as unknown as LazyExoticComponent<ComponentType<AppLoaderProps>>, singleton: false, category: "records", showInLauncher: false },
  { id: "records/:definitionId/new", titleKey: "app.newRecord", icon: ListChecks, loader: RecordDetail, singleton: false, category: "records", showInLauncher: false },
  { id: "collections/new", titleKey: "app.newCollection", icon: FileText, loader: RecordDefinitionEdit, singleton: false, category: "records", showInLauncher: false },
  { id: "collections/:id/edit", titleKey: "app.editCollection", icon: FileText, loader: RecordDefinitionEdit, singleton: false, category: "records", showInLauncher: false },
  { id: "patient-view", titleKey: "app.patientView", icon: Users, loader: PatientRecordView, singleton: true, category: "records", showInLauncher: false },
  { id: "patient-edit", titleKey: "app.patientEdit", icon: Pencil, loader: PatientRecordFormPage, singleton: true, category: "records", showInLauncher: false },
  { id: "record-detail", titleKey: "app.recordDetail", icon: FileText, loader: RecordDetail, singleton: true, category: "records", showInLauncher: false },
] as AppDef[]).map((a) => ({ ...a, iconSvg: APP_SVG_ICONS[a.id] }));

export function getApp(id: string): AppDef | undefined {
  return APPS.find((a) => a.id === id);
}

/**
 * Resolve an app's display title, defending against unresolved i18n keys.
 *
 * i18next returns the key itself on a miss (there is no `saveMissing`), which
 * is how 13 window titles, the dock and the launcher ended up rendering the
 * literal text "patients" / "dashboard". If the resolved string still looks
 * like a key, fall back to a humanised app id so a missing translation can
 * never surface as a raw dotted identifier to a clinician.
 */
const LOOKS_LIKE_UNRESOLVED_KEY = /^[a-z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/;

export function resolveAppTitle(
  t: (key: string, options?: Record<string, unknown>) => string,
  app: AppDef,
): string {
  const resolved = t(app.titleKey);
  if (resolved && resolved !== app.titleKey && !LOOKS_LIKE_UNRESOLVED_KEY.test(resolved)) {
    return resolved;
  }
  return app.id
    .split(/[/:]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Apps the launcher grid may spawn (parameterised apps are excluded). */
export function launcherApps(): AppDef[] {
  return APPS.filter((a) => a.showInLauncher !== false);
}
