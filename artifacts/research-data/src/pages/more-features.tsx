import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { isDesktopMode } from "@/lib/desktop-mode";
import { useDesktopOptional } from "@/components/desktop/window-store";
import {
  Image,
  Download,
  BrainCircuit,
  ShieldAlert,
  ScrollText,
  Search,
  FileText,
  FileCheck,
  Eraser,
  Users,
  Tags,
  CheckCircle,
  FlaskConical,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FeatureKey =
  | "dicom"
  | "export"
  | "ml"
  | "gdpr"
  | "audit"
  | "search"
  | "reports"
  | "consent"
  | "deidentify"
  | "cohort"
  | "coding"
  | "validation"
  | "studies"
  | "ingest";

interface FeatureMeta {
  key: FeatureKey;
  href: string;
  appId: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  editorOnly?: boolean;
}

const FEATURES: FeatureMeta[] = [
  { key: "dicom", href: "/dicom", appId: "dicom", icon: Image },
  { key: "export", href: "/export", appId: "export", icon: Download },
  { key: "ml", href: "/ml", appId: "ml", icon: BrainCircuit, editorOnly: true },
  { key: "gdpr", href: "/gdpr", appId: "gdpr", icon: ShieldAlert, adminOnly: true },
  { key: "audit", href: "/activity", appId: "activity", icon: ScrollText, adminOnly: true },
  { key: "search", href: "/search", appId: "search", icon: Search },
  { key: "reports", href: "/reports", appId: "reports", icon: FileText },
  { key: "consent", href: "/consent", appId: "consent", icon: FileCheck },
  { key: "deidentify", href: "/deidentify", appId: "deidentify", icon: Eraser, editorOnly: true },
  { key: "cohort", href: "/cohort", appId: "cohort", icon: Users },
  { key: "coding", href: "/coding", appId: "coding", icon: Tags, editorOnly: true },
  { key: "validation", href: "/validation", appId: "validation", icon: CheckCircle, editorOnly: true },
  { key: "studies", href: "/studies", appId: "studies", icon: FlaskConical },
  { key: "ingest", href: "/ingest", appId: "ingest", icon: Upload, editorOnly: true },
];

export default function MoreFeatures() {
  const { t } = useTranslation();
  const { canAdminAccess, canEdit } = useAuth();
  const desktop = isDesktopMode() ? useDesktopOptional() : null;

  const visible = FEATURES.filter((f) => {
    if (f.adminOnly && !canAdminAccess) return false;
    if (f.editorOnly && !canEdit) return false;
    return true;
  });

  const handleOpen = (f: FeatureMeta) => {
    if (desktop) {
      desktop.open(f.appId);
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("features.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("features.subtitle")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((f) => {
            const Icon = f.icon;
            const content = (
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <CardTitle className="text-base">{t(`features.${f.key}.title`)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{t(`features.${f.key}.desc`)}</p>
                </CardContent>
              </Card>
            );

            if (desktop) {
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => handleOpen(f)}
                  className="block w-full text-left cursor-pointer"
                >
                  {content}
                </button>
              );
            }

            return (
              <Link key={f.key} href={f.href}>
                {content}
              </Link>
            );
          })}
        </div>

        {visible.length === 0 && (
          <p className={cn("text-sm text-muted-foreground")}>No additional features available for your role.</p>
        )}
      </div>
    </Layout>
  );
}
