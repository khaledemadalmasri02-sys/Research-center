import { useEffect, useState } from "react";
import { useAuth, canAdmin } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, ApiError } from "../lib/api";
import { Card, Table } from "../components/ui";

export default function Audit() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [entries, setEntries] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canAdmin(user)) return;
    apiGet<{ entries: any[] }>("/api/audit?limit=100")
      .then((d) => setEntries(d.entries || []))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed."));
  }, [user]);

  if (!canAdmin(user)) return <div className="text-sm text-slate-500">Admin only.</div>;
  if (error) return <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navAudit")}</h1>
      <Card>
        <Table
          headers={["Time", "User", "Action", "Entity", "Detail"]}
          rows={entries.map((e) => [
            e.createdAt, e.userId ?? "—", e.action, `${e.entity ?? ""}#${e.entityId ?? ""}`,
            typeof e.detail === "object" ? JSON.stringify(e.detail) : e.detail ?? "",
          ])}
        />
      </Card>
    </div>
  );
}
