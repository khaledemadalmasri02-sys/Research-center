import { useEffect, useState } from "react";
import { useAuth, canEdit } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Card, Button, Input, Select, Table, Badge } from "../components/ui";

interface Version { id: number; code: string; label: string; irb_number: string | null; text: string | null; }
interface ConsentRow { id: number; consent_version_id: number; status: string; signed_at: string | null; withdrawn_at: string | null; }

export default function Consent() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [versions, setVersions] = useState<Version[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [patientId, setPatientId] = useState("");
  const [versionId, setVersionId] = useState<number | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadVersions = () =>
    apiGet<{ versions: Version[] }>("/api/consent/versions").then((d) => setVersions(d.versions || []));
  const loadConsents = () => {
    if (!patientId) return setConsents([]);
    apiGet<{ consents: ConsentRow[] }>(`/api/consent/?patientId=${encodeURIComponent(patientId)}`)
      .then((d) => setConsents(d.consents || []))
      .catch(() => setConsents([]));
  };

  useEffect(() => {
    loadVersions();
  }, []);
  useEffect(() => {
    loadConsents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const sign = async () => {
    setError("");
    if (!patientId || versionId === "") return setError("Patient ID and template required.");
    setBusy(true);
    try {
      await apiPost("/api/consent/", { patientId: Number(patientId), consentVersionId: Number(versionId), status: "signed" });
      setVersionId("");
      loadConsents();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to sign.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: number) => {
    try {
      await apiPost(`/api/consent/${id}/withdraw`, {});
      loadConsents();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to withdraw.");
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navConsent")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <h2 className="mb-2 font-medium">{t("consentVersions")}</h2>
        <Table
          headers={["Code", "Label", "IRB", "Text"]}
          rows={versions.map((v) => [v.code, v.label, v.irb_number || "—", (v.text || "").slice(0, 60) + "…"])}
        />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">{t("signConsent")}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500">{t("patientId")}</label>
            <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="P001" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Template</label>
            <Select value={versionId} onChange={(e) => setVersionId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </Select>
          </div>
          <Button disabled={!canEdit(user) || busy} onClick={sign}>{t("signConsent")}</Button>
        </div>
        {!canEdit(user) && <p className="mt-2 text-xs text-slate-400">Editors and admins can sign consents.</p>}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">{t("consents")}</h2>
        <Table
          headers={["ID", "Template", "Status", "Signed", "Withdrawn", ""]}
          rows={consents.map((c) => [
            c.id,
            c.consent_version_id,
            <Badge key={c.id}>{c.status}</Badge>,
            c.signed_at || "—",
            c.withdrawn_at || "—",
            c.status === "signed" ? (
              <Button key={"w" + c.id} variant="danger" onClick={() => withdraw(c.id)}>{t("withdraw")}</Button>
            ) : null,
          ])}
        />
      </Card>
    </div>
  );
}
