export interface Patient {
  id: number;
  collectionName?: string;
  collectionDate?: string;
  collectionType?: string;
  patientId: string;
  patientName: string;
  age?: number;
  sex?: string;
  dateOfVisit?: string;
  chiefComplaint?: string;
  vitalSigns?: string;
  historyTrauma?: string;
  mechanismOfInjuryAndLocalisation?: string;
  signsAndSymptomsTrauma?: string;
  historyMedical?: string;
  signsAndSymptomsMedical?: string;
  riskFactors?: string;
  provisionalDiagnosis?: string;
  radiologyImageFilePathOrLink?: string;
  radiologyImages?: string;
  emergencyReport?: string;
  aiPredictionOutput?: string;
  finalConfirmedDiagnosisAr?: string;
  finalConfirmedDiagnosis?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

let patients: Patient[] = [];
let nextId = 1;

export function initDb() {
  patients = [];
  nextId = 1;
}

export function getAllPatients() {
  return patients;
}

export function getPatient(id: number) {
  return patients.find((p) => p.id === id);
}

export function createPatient(data: Omit<Patient, "id" | "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const patient: Patient = {
    id: nextId++,
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  patients.push(patient);
  return patient;
}

export function updatePatient(id: number, data: Partial<Patient>) {
  const index = patients.findIndex((p) => p.id === id);
  if (index === -1) return null;
  patients[index] = {
    ...patients[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  return patients[index];
}

export function deletePatient(id: number) {
  const index = patients.findIndex((p) => p.id === id);
  if (index === -1) return null;
  return patients.splice(index, 1)[0];
}

export function clearDb() {
  patients = [];
  nextId = 1;
}