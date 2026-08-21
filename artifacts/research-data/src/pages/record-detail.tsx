import { type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { RecordForm } from "@/components/record-form";
import { recordsApi } from "@/lib/records";

export default function RecordDetail({
  definitionId: defIdProp,
  recordId: recIdProp,
  header,
  backHref,
}: {
  definitionId?: number;
  recordId?: number;
  header?: ReactNode;
  backHref?: string;
}) {
  const { definitionId: pDef, recordId: pRec } = useParams();
  const defId = defIdProp ?? Number(pDef);
  const navBack = backHref ?? `/records/${defId}`;
  const recId = recIdProp ?? (pRec ? Number(pRec) : undefined);
  const isEdit = !!recId;
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: defData, isLoading: defLoading } = useQuery({
    queryKey: ["record-definition", defId],
    queryFn: () => recordsApi.getDefinition(defId),
    enabled: !!defId,
  });

  const { data: recData, isLoading: recLoading } = useQuery({
    queryKey: ["record", recId],
    queryFn: () => recordsApi.getRecord(recId!),
    enabled: !!recId,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      if (recId) return recordsApi.updateRecord(recId, data);
      return recordsApi.createRecord(defId, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["records", defId] });
      navigate(navBack);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => recordsApi.deleteRecord(recId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["records", defId] });
      navigate(navBack);
    },
  });

  if (defLoading || (isEdit && recLoading)) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!defData?.definition) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto">
          <p>Collection not found.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          {header}
          <Button variant="ghost" size="sm" onClick={() => navigate(navBack)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-3xl font-bold tracking-tight mt-2">
            {isEdit ? "Edit Record" : "New Record"}
          </h1>
          {isEdit && (
            <Button
              variant="destructive"
              size="sm"
              className="mt-2"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm("Delete this record?")) deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete record"}
            </Button>
          )}
        </div>

        <RecordForm
          definition={defData.definition}
          initialData={recData?.record.data}
          submitting={saveMutation.isPending}
          onSubmit={(data) => saveMutation.mutateAsync(data).then(() => undefined)}
          onCancel={() => navigate(navBack)}
        />
      </div>
    </Layout>
  );
}
