import { useDefaultDefinition, PATIENTS_DEFINITION_NAME } from "@/lib/records";
import { PatientRecordForm } from "@/components/patient-record-form";
import RecordDetail from "@/pages/record-detail";
import { Link } from "wouter";
import { Info, Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";

export default function NewRecordPage() {
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
        New records are saved to the <b>{def?.name ?? "default"}</b> collection — your{" "}
        <b>default collection</b>. To change where new records are added, open{" "}
        <Link href="/collections" className="text-primary underline font-medium">
          Data Collections
        </Link>{" "}
        and click <b>Set as default</b> on the collection you want.
      </div>
    </div>
  );

  if (!def) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto space-y-6">
          {guide}
          <p className="text-muted-foreground">No collection is available yet. Create one in Data Collections first.</p>
        </div>
      </Layout>
    );
  }

  if (def.name === PATIENTS_DEFINITION_NAME) {
    return <PatientRecordForm guide={guide} />;
  }

  return <RecordDetail definitionId={def.id} backHref="/patients" header={guide} />;
}
