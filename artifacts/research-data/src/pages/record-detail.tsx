import { type ReactNode, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/hooks/use-toast";
import { RecordForm } from "@/components/record-form";
import { recordsApi } from "@/lib/records";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { routeSegments } from "@/lib/route-params";

export default function RecordDetail({
  definitionId: defIdProp,
  recordId: recIdProp,
  header,
  backHref,
  route,
}: {
  definitionId?: number;
  recordId?: number;
  header?: ReactNode;
  backHref?: string;
  route?: string;
}) {
  const { definitionId: pDef, recordId: pRec } = useParams();
  // In the desktop shell there is no wouter <Route>, so useParams() is empty.
  // Fall back to the window `route` prop (e.g. "/records/5/133").
  const segs = routeSegments(route);
  const fromRoute = segs[0] === "records";
  const pDefId = pDef ?? (fromRoute ? segs[1] : undefined);
  const pRecId = pRec ?? (fromRoute ? segs[2] : undefined);
  const defId = defIdProp ?? Number(pDefId);
  const navBack = backHref ?? `/records/${defId}`;
  const recId = recIdProp ?? (pRecId ? Number(pRecId) : undefined);
  const isEdit = !!recId;
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dirty, setDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useUnsavedChanges(dirty);

  const {
    data: defData,
    isLoading: defLoading,
    isError: defError,
    refetch: refetchDef,
  } = useQuery({
    queryKey: ["record-definition", defId],
    queryFn: () => recordsApi.getDefinition(defId),
    enabled: !!defId,
  });

  const {
    data: recData,
    isLoading: recLoading,
    isError: recError,
    refetch: refetchRec,
  } = useQuery({
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
    onError: (e) =>
      toast({ title: t("destructive.failed"), description: (e as Error).message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => recordsApi.deleteRecord(recId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["records", defId] });
      toast({ title: t("records.deleted"), description: t("records.deletedBody") });
      navigate(navBack);
    },
  });

  if (defLoading || (isEdit && recLoading)) {
    return (
      <Layout>
        <div className="flex justify-center py-12" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  /**
   * A failed record fetch used to fall straight through to the edit form with
   * `initialData === undefined`, i.e. an EMPTY form — which invites the user
   * to "save" their way into a duplicate record. Refuse to render the form
   * until the data has resolved.
   */
  if (defError || (isEdit && recError)) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <ErrorState
            title={t("common.errorTitle")}
            description={isEdit ? t("recordDetail.loadFailed") : t("records.loadFailed")}
            action={
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    void refetchDef();
                    void refetchRec();
                  }}
                >
                  {t("common.retry")}
                </Button>
                <Button variant="outline" onClick={() => navigate(navBack)}>
                  {t("common.back")}
                </Button>
              </div>
            }
          />
        </div>
      </Layout>
    );
  }

  if (!defData?.definition || (isEdit && !recData?.record)) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <ErrorState
            title={t("recordDetail.notFound")}
            action={
              <Button onClick={() => navigate(navBack)}>{t("common.back")}</Button>
            }
          />
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
            <ArrowLeft className="h-4 w-4 mr-1 rtl:rotate-180" /> {t("common.back")}
          </Button>
          <h1 className="text-3xl font-bold tracking-tight mt-2">
            {isEdit ? t("common.editRecord") : t("patients.newRecord")}
          </h1>
          {isEdit && (
            <Button
              variant="destructive"
              size="sm"
              className="mt-2"
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              {deleteMutation.isPending ? t("common.deleting") : t("common.deleteRecord")}
            </Button>
          )}
        </div>

        <RecordForm
          definition={defData.definition}
          initialData={recData?.record.data}
          submitting={saveMutation.isPending}
          onSubmit={(data) => saveMutation.mutateAsync(data).then(() => undefined)}
          onCancel={() => navigate(navBack)}
          onDirtyChange={setDirty}
        />
      </div>

      <ConfirmDestructive
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("records.deleteTitle")}
        description={t("destructive.body")}
        subject={defData.definition.name}
        confirmLabel={t("common.delete")}
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </Layout>
  );
}
