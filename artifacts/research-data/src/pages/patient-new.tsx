import { Layout } from "@/components/layout";
import { PatientForm } from "@/components/patient-form";

export default function NewPatient() {
  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Patient Record</h1>
          <p className="text-muted-foreground mt-1">Enter details for a new clinical record.</p>
        </div>
        <PatientForm />
      </div>
    </Layout>
  );
}
