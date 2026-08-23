import { useEffect, useState } from "react";
import { useAuth, canEdit } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Card, Button, Input, Select, Table, Badge } from "../components/ui";

const MODALITIES = ["", "CT", "MR", "CR", "DX", "US", "PT", "OT"];

export default function Dicom() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [patientId, setPatientId] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [modality, setModality] = useState("CT");
  const [studies, setStudies] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [error, setError] = useState("");

  const loadStudies = async () => {
    if (!patientId) return setStudies([]);
    setError("");
    try {
      const d = await apiGet<{ studies: any[] }>(`/api/dicom/studies/${patientId}`);
      setStudies(d.studies || []);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const loadImages = async () => {
    if (!patientId) return;
    const d = await apiGet<{ images: any[] }>(`/api/dicom/images?patientId=${patientId}`).catch(() => ({ images: [] }));
    setImages(d.images || []);
  };

  useEffect(() => { loadImages(); /* eslint-disable-next-line */ }, [patientId]);

  const save = async () => {
    setError("");
    if (!patientId || !objectKey) return setError("patientId and objectKey required.");
    try {
      await apiPost("/api/dicom/metadata", {
        patientId: Number(patientId), objectKey, modality: modality || undefined,
      });
      setObjectKey("");
      loadImages();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const deid = async (id: number) => {
    await apiPost(`/api/dicom/deidentify`, { id });
    loadImages();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navDicom")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="Patient ID" />
          <Input value={objectKey} onChange={(e) => setObjectKey(e.target.value)} placeholder="R2 object key" />
          <Select value={modality} onChange={(e) => setModality(e.target.value)}>
            {MODALITIES.map((m) => <option key={m} value={m}>{m || "—"}</option>)}
          </Select>
          <Button disabled={!canEdit(user)} onClick={save}>Save metadata</Button>
          <Button variant="secondary" onClick={loadStudies}>Load studies</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Studies</h2>
        <Table headers={["Study UID", "Modality", "Body part", "Date", "Images"]} rows={studies.map((s) => [s.studyInstanceUid, s.modality || "—", s.bodyPart || "—", s.acquisitionDate || "—", s.imageCount])} />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Images</h2>
        <Table
          headers={["ID", "Modality", "De-identified", ""]}
          rows={images.map((im) => [
            im.id, im.modality || "—", im.isDeidentified ? <Badge key={im.id}>yes</Badge> : "no",
            <Button key={"x" + im.id} variant="secondary" onClick={() => deid(im.id)}>De-identify</Button>,
          ])}
        />
      </Card>
    </div>
  );
}
