import { useEffect, useState } from "react";
import { useAuth, canEdit } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Card, Button, Input, Select, Table, Badge } from "../components/ui";

interface Study { id: number; code: string; title: string; irbNumber: string | null; status: string; enrollmentTarget: number; enrolled: number; siteCount: number; }
interface Dashboard { study: { id: number; code: string; title: string; target: number }; enrolled: number; remaining: number; sites: { id: number; name: string; country: string | null; enrolled: number }[]; }

export default function Studies() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [studies, setStudies] = useState<Study[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteCountry, setSiteCountry] = useState("");
  const [armName, setArmName] = useState("");
  const [arms, setArms] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState("");

  const load = () => apiGet<{ studies: Study[] }>("/api/studies").then((d) => setStudies(d.studies || []));
  useEffect(() => { load(); }, []);

  const open = async (id: number) => {
    setSelected(id);
    const d = await apiGet<Dashboard>(`/api/studies/${id}/dashboard`);
    setDash(d);
    const a = await apiGet<{ arms: { id: number; name: string }[] }>(`/api/studies/${id}/arms`);
    setArms(a.arms || []);
  };

  const createStudy = async () => {
    setError("");
    if (!code || !title) return setError("Code and title required.");
    try {
      await apiPost("/api/studies", { code, title, enrollmentTarget: Number(target) || 0 });
      setCode(""); setTitle(""); setTarget("");
      load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const addSite = async () => {
    if (!selected || !siteName) return;
    try {
      await apiPost(`/api/studies/${selected}/sites`, { name: siteName, country: siteCountry });
      setSiteName(""); setSiteCountry("");
      open(selected);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const addArm = async () => {
    if (!selected || !armName) return;
    try {
      await apiPost(`/api/studies/${selected}/arms`, { name: armName });
      setArmName("");
      open(selected);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navStudies")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      {canEdit(user) && (
        <Card>
          <h2 className="mb-2 font-medium">New study</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" />
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Enrollment target" />
            <Button onClick={createStudy}>Create</Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-medium">Studies</h2>
        <Table
          headers={["Code", "Title", "Status", "Enrolled", "Sites", ""]}
          rows={studies.map((s) => [
            s.code, s.title, <Badge key={s.id}>{s.status}</Badge>, `${s.enrolled}/${s.enrollmentTarget}`, s.siteCount,
            <Button key={"o" + s.id} variant="secondary" onClick={() => open(s.id)}>Open</Button>,
          ])}
        />
      </Card>

      {dash && (
        <Card>
          <h2 className="mb-2 font-medium">{dash.study.code} — {dash.study.title}</h2>
          <p className="mb-2 text-sm">
            Enrolled: <b>{dash.enrolled}</b> / {dash.study.target} · Remaining: <b>{dash.remaining}</b>
          </p>
          <Table headers={["Site", "Country", "Enrolled"]} rows={dash.sites.map((s) => [s.name, s.country || "—", s.enrolled])} />

          {canEdit(user) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="mb-1 text-sm font-medium">Add site</h3>
                <div className="flex flex-wrap items-end gap-2">
                  <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Site name" />
                  <Input value={siteCountry} onChange={(e) => setSiteCountry(e.target.value)} placeholder="Country" />
                  <Button onClick={addSite}>Add</Button>
                </div>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium">Add arm</h3>
                <div className="flex flex-wrap items-end gap-2">
                  <Input value={armName} onChange={(e) => setArmName(e.target.value)} placeholder="Arm name" />
                  <Button onClick={addArm}>Add</Button>
                </div>
                <div className="mt-2 text-xs text-slate-500">{arms.map((a) => a.name).join(", ") || "No arms"}</div>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
