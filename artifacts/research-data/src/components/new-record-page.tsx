import { useDefaultDefinition, PATIENTS_DEFINITION_NAME } from "@/lib/records";
import { PatientRecordForm } from "@/components/patient-record-form";
import RecordDetail from "@/pages/record-detail";
import { Link } from "wouter";
import { Info, Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { useTranslation } from "react-i18next";

export default function NewRecordPage() {
  const { t } = useTranslation();
  const { data: def, isLoading } = useDefaultDefinition();

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  const guide = (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm flex gap-3">
      <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
      <div className="leading-relaxed">
        {t("newRecord.guidePre")} <b>{def?.name ?? t("newRecord.defaultFallback")}</b>{" "}
        {t("newRecord.guideName")} <b>{t("newRecord.guideDefault")}</b>.{" "}
        {t("newRecord.guideChangePre")}{" "}
        <Link href="/collections" className="text-primary underline font-medium">
          {t("newRecord.guideLink")}
        </Link>{" "}
        {t("newRecord.guideChangePost")} <b>{t("newRecord.guideAction")}</b>{" "}
        {t("newRecord.guideActionPost")}
      </div>
    </div>
  );

  if (!def) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto space-y-6">
          {guide}
          <div>
            <p className="font-medium">{t("newRecord.noCollectionTitle")}</p>
            <p className="text-sm">{t("newRecord.noCollectionBody")}</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (def.name === PATIENTS_DEFINITION_NAME) {
    return <PatientRecordForm guide={guide} />;
  }

  return <RecordDetail definitionId={def.id} backHref="/patients" header={guide} />;
}
