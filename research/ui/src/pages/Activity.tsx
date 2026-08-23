import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, ApiError } from "../lib/api";
import { Card, Table } from "../components/ui";

export default function Activity({ me }: { me?: boolean }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [entries, setEntries] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const url = me ? "/api/audit/me?limit=100" : "/api/audit?limit=100";
    apiGet<{ entries: any[] }>(url)
      .then((d) => setEntries(d.entries || []))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed."));
  }, [user, me]);

  if (error) return <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{me ? t("navMyActivity") : t("navActivity")}</h1>
      <Card>
        <Table
          headers={["Time", "Action", "Entity", "Detail"]}
          rows={entries.map((e) => [
            e.createdAt, e.action, `${e.entity ?? ""}#${e.entityId ?? ""}`,
            typeof e.detail === "object" ? JSON.stringify(e.detail) : e.detail ?? "",
          ])}
        />
      </Card>
    </div>
  );
}
