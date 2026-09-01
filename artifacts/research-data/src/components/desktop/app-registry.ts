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
} from "lucide-react";

export interface AppDef {
  id: string;
  titleKey: string;
  icon: typeof LayoutDashboard;
  loader: LazyExoticComponent<ComponentType>;
  defaultSize?: { w: number; h: number };
  singleton?: boolean;
  adminOnly?: boolean;
  category?: string;
  showInDock?: boolean;
  iconSvg?: ComponentType<{ className?: string }>;
}

export const Home = lazy(() => import("@/pages/home"));
export const Patients = lazy(() => import("@/pages/patients"));
export const Login = lazy(() => import("@/pages/login"));
export const Signup = lazy(() => import("@/pages/signup"));
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
// dock, the app launcher, and the window manager. `titleKey` maps to existing
// i18n `nav.*` keys where available; others use an `app.*` key (add to i18n later).
export const APPS: AppDef[] = [
  { id: "home", titleKey: "dashboard", icon: LayoutDashboard, loader: Home, singleton: true, showInDock: true, category: "main" },
  { id: "patients", titleKey: "patients", icon: Users, loader: Patients, singleton: true, showInDock: true, category: "main" },
  { id: "patients/new", titleKey: "newPatient", icon: UserPlus, loader: NewRecordPage, singleton: false, showInDock: false, category: "main" },
  { id: "collections", titleKey: "collections", icon: FileText, loader: Collections, singleton: true, showInDock: true, category: "main" },
  { id: "data-analysis", titleKey: "dataAnalysis", icon: BarChart3, loader: DataAnalysis, singleton: true, showInDock: true, category: "main" },
  { id: "feedback", titleKey: "feedback", icon: MessageSquare, loader: Feedback, singleton: true, showInDock: true, category: "main" },
  { id: "more-features", titleKey: "moreFeatures", icon: LayoutGrid, loader: MoreFeatures, singleton: true, showInDock: true, category: "main" },
  { id: "database", titleKey: "database", icon: DatabaseIcon, loader: Database, singleton: true, adminOnly: true, showInDock: false, category: "admin" },
  { id: "admin", titleKey: "admin", icon: ShieldAlert, loader: Admin, singleton: true, adminOnly: true, showInDock: false, category: "admin" },
  { id: "activity", titleKey: "activity", icon: ActivityIcon, loader: Activity, singleton: true, adminOnly: true, showInDock: false, category: "admin" },
  { id: "activity/me", titleKey: "myActivity", icon: History, loader: ActivityMe, singleton: true, showInDock: false, category: "utility" },
  { id: "api-tokens", titleKey: "apiTokens", icon: KeyRound, loader: ApiTokens, singleton: true, showInDock: false, category: "utility" },
  { id: "sessions", titleKey: "sessions", icon: Monitor, loader: Sessions, singleton: true, showInDock: false, category: "utility" },
  { id: "settings", titleKey: "nav.settings", icon: SettingsIcon, loader: Settings, singleton: true, category: "utility" },
  { id: "theme-manager", titleKey: "themeManager", icon: Palette, loader: ThemeManager, singleton: true, showInDock: true, category: "utility" },
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
  { id: "records/:definitionId", titleKey: "app.records", icon: List, loader: RecordList, singleton: false, category: "records" },
  { id: "collections/new", titleKey: "app.newCollection", icon: FileText, loader: RecordDefinitionEdit, singleton: false, category: "records" },
  { id: "collections/:id/edit", titleKey: "app.editCollection", icon: FileText, loader: RecordDefinitionEdit, singleton: false, category: "records" },
  { id: "patient-view", titleKey: "app.patientView", icon: Users, loader: PatientRecordView, singleton: true, category: "records" },
  { id: "patient-edit", titleKey: "app.patientEdit", icon: Pencil, loader: PatientRecordFormPage, singleton: true, category: "records" },
  { id: "record-detail", titleKey: "app.recordDetail", icon: FileText, loader: RecordDetail, singleton: true, category: "records" },
].map((a) => ({ ...a, iconSvg: APP_SVG_ICONS[a.id] }));

export function getApp(id: string): AppDef | undefined {
  return APPS.find((a) => a.id === id);
}
