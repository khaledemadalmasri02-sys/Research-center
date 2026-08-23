import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { Card } from "../components/ui";
import { Link } from "react-router-dom";

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const cards = [
    ["/consent", t("navConsent")],
    ["/cohort", t("navCohort")],
    ["/dicom", t("navDicom")],
    ["/studies", t("navStudies")],
    ["/ml", t("navMl")],
    ["/reports", t("navReports")],
    ["/search", t("navSearch")],
  ] as const;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("appName")}</h1>
      <p className="text-sm text-slate-500">
        {user ? `Signed in as ${user.username} (${user.role})` : t("login") + " to continue."}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map(([to, label]) => (
          <Link key={to} to={to}>
            <Card className="h-full transition hover:border-blue-500">{label}</Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
