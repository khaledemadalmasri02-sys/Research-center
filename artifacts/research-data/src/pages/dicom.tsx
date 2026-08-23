import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Image } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

const MODALITIES = ["", "CT", "MR", "CR", "DX", "US", "PT", "OT"];

async function getJson(url: string) { const r = await fetch(url, { credentials: "include" }); if (!r.ok) throw new Error("Failed"); return r.json(); }
async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error((b as any).error || "Failed"); }
  return r.json();
}

export default function Dicom() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [modality, setModality] = useState("CT");
  const [studies, setStudies] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);

  const loadStudies = async () => {
    if (!patientId) return;
    const d = await getJson(`/api/dicom/studies/${patientId}`).catch(() => ({ studies: [] }));
    setStudies(d.studies || []);
  };
  const loadImages = async () => {
    if (!patientId) return;
    const d = await getJson(`/api/dicom/images?patientId=${patientId}`).catch(() => ({ images: [] }));
    setImages(d.images || []);
  };
  const save = useMutation({
    mutationFn: () => postJson("/api/dicom/metadata", { patientId: Number(patientId), objectKey, modality: modality || undefined }),
    onSuccess: () => { setObjectKey(""); loadImages(); },
  });
  const deid = useMutation({
    mutationFn: (id: number) => postJson(`/api/dicom/deidentify`, { id }),
    onSuccess: () => loadImages(),
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Image className="h-7 w-7 text-primary" /> {t("features.dicom.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.dicom.desc")}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Patient</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label>Patient ID</Label><Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="e.g. 12" /></div>
            <div className="space-y-1"><Label>Object key</Label><Input value={objectKey} onChange={(e) => setObjectKey(e.target.value)} placeholder="R2 key" /></div>
            <div className="space-y-1"><Label>Modality</Label>
              <Select value={modality} onValueChange={setModality}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{MODALITIES.map((m) => <SelectItem key={m} value={m}>{m || "—"}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button disabled={!canEdit || !patientId || !objectKey || save.isPending} onClick={() => save.mutate()}>Save metadata</Button>
            <Button variant="secondary" onClick={loadStudies}>Load studies</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Studies</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Study UID</TableHead><TableHead>Modality</TableHead><TableHead>Body part</TableHead><TableHead>Date</TableHead><TableHead>Images</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(studies || []).map((s: any, i: number) => (
                    <TableRow key={i}><TableCell>{s.studyInstanceUid}</TableCell><TableCell>{s.modality || "—"}</TableCell><TableCell>{s.bodyPart || "—"}</TableCell><TableCell>{s.acquisitionDate || "—"}</TableCell><TableCell>{s.imageCount}</TableCell></TableRow>
                  ))}
                  {!studies.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No studies.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Images</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Modality</TableHead><TableHead>De-identified</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {(images || []).map((im: any) => (
                    <TableRow key={im.id}>
                      <TableCell>{im.id}</TableCell><TableCell>{im.modality || "—"}</TableCell>
                      <TableCell>{im.isDeidentified ? <Badge>yes</Badge> : "no"}</TableCell>
                      <TableCell>{canEdit && <Button variant="outline" size="sm" onClick={() => deid.mutate(im.id)}>De-identify</Button>}</TableCell>
                    </TableRow>
                  ))}
                  {!images.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No images.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
