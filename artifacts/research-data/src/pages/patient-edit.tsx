import { Layout } from "@/components/layout";
import { PatientForm } from "@/components/patient-form";
import { useGetPatient, getGetPatientQueryKey } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditPatient() {
  const { id } = useParams();
  const patientId = Number(id);
  
  const { data: patient, isLoading } = useGetPatient(patientId, {
    query: { enabled: !!patientId, queryKey: getGetPatientQueryKey(patientId) }
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Patient Record</h1>
          <p className="text-muted-foreground mt-1">Update details for patient {patient?.patientId}</p>
        </div>
        
        {isLoading ? (
          <div className="space-y-8">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : patient ? (
          <PatientForm initialData={patient} isEdit />
        ) : (
          <div>Patient not found</div>
        )}
      </div>
    </Layout>
  );
}
