export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea" | "image";
  options?: string[];
  required?: boolean;
}

export interface RecordDefinition {
  id: number;
  userId: number;
  name: string;
  fields: FieldDef[];
  shared?: boolean;
  isActive?: boolean;
  isDefault?: boolean;
  deactivated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecordRow {
  id: number;
  userId: number;
  definitionId: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as any).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

import { useQuery } from "@tanstack/react-query";

export const PATIENTS_DEFINITION_NAME = "Patients";

export const recordsApi = {
  listDefinitions: (params: { scopeAll?: boolean; shared?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.scopeAll) qs.set("scope", "all");
    if (params.shared) qs.set("shared", "1");
    const q = qs.toString();
    return fetch(`/api/records/definitions${q ? `?${q}` : ""}`, { credentials: "include" }).then((r) =>
      json<{ definitions: RecordDefinition[] }>(r),
    );
  },

  createDefinition: (name: string, fields: FieldDef[]) =>
    fetch("/api/records/definitions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, fields }),
    }).then((r) => json<{ definition: RecordDefinition }>(r)),

  getDefinition: (id: number) =>
    fetch(`/api/records/definitions/${id}`, { credentials: "include" }).then((r) =>
      json<{ definition: RecordDefinition }>(r),
    ),

  updateDefinition: (id: number, body: { name?: string; fields?: FieldDef[] }) =>
    fetch(`/api/records/definitions/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<{ definition: RecordDefinition }>(r)),

  deleteDefinition: (id: number) =>
    fetch(`/api/records/definitions/${id}`, { method: "DELETE", credentials: "include" }).then((r) =>
      json<{ ok: true }>(r),
    ),

  listRecords: (definitionId?: number, scopeAll = false) => {
    const params = new URLSearchParams();
    if (definitionId) params.set("definitionId", String(definitionId));
    if (scopeAll) params.set("scope", "all");
    const qs = params.toString();
    return fetch(`/api/records${qs ? `?${qs}` : ""}`, { credentials: "include" }).then((r) =>
      json<{ records: RecordRow[] }>(r),
    );
  },

  createRecord: (definitionId: number, data: Record<string, unknown>) =>
    fetch("/api/records", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definitionId, data }),
    }).then((r) => json<{ record: RecordRow }>(r)),

  getRecord: (id: number) =>
    fetch(`/api/records/${id}`, { credentials: "include" }).then((r) =>
      json<{ record: RecordRow; definition: RecordDefinition | null }>(r),
    ),

  updateRecord: (id: number, data: Record<string, unknown>) =>
    fetch(`/api/records/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).then((r) => json<{ record: RecordRow }>(r)),

  deleteRecord: (id: number) =>
    fetch(`/api/records/${id}`, { method: "DELETE", credentials: "include" }).then((r) =>
      json<{ ok: true }>(r),
    ),

  searchRecords: (definitionId: number, params: { q?: string; filters?: Record<string, unknown>; sort?: Record<string, unknown> } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.filters) qs.set("filters", JSON.stringify(params.filters));
    if (params.sort) qs.set("sort", JSON.stringify(params.sort));
    const q = qs.toString();
    return fetch(`/api/records/${definitionId}/search${q ? `?${q}` : ""}`, { credentials: "include" }).then((r) =>
      json<{ records: RecordRow[]; total: number }>(r),
    );
  },

  activateDefinition: (id: number) =>
    fetch(`/api/records/definitions/${id}/activate`, {
      method: "PATCH",
      credentials: "include",
    }).then((r) => json<{ ok: true }>(r)),

  deactivateDefinition: (id: number) =>
    fetch(`/api/records/definitions/${id}/deactivate`, {
      method: "PATCH",
      credentials: "include",
    }).then((r) => json<{ ok: true }>(r)),

  setDefaultDefinition: (id: number, isDefault: boolean) =>
    fetch(`/api/records/definitions/${id}/default`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault }),
    }).then((r) => json<{ ok: true }>(r)),

  importRecords: (definitionId: number, rows: Record<string, unknown>[]) =>
    fetch(`/api/records/${definitionId}/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    }).then((r) => json<{ inserted: number }>(r)),

  exportRecords: (definitionId: number, format: "csv" | "excel") => {
    const a = document.createElement("a");
    a.href = `/api/records/${definitionId}/export?format=${format}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
};

export interface CollectionOverview {
  id: number;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  shared: boolean;
  deactivated: boolean;
  recordCount: number;
  recentCount: number;
  updatedAt: string;
}

export interface FieldStatValue {
  value: string;
  count: number;
}

export interface FieldStat {
  key: string;
  label: string;
  type: FieldDef["type"];
  values?: FieldStatValue[];
  numeric?: { count: number; min: number; max: number; avg: number };
}

export interface CollectionsStats {
  overview: CollectionOverview[];
  summary: { total: number; recentCount: number; collectionCount: number; selectedIds: number[] };
  perCollection: { id: number; name: string; total: number; recentCount: number }[];
  fieldStats: FieldStat[];
}

export const collectionsApi = {
  getStats: (definitionIds?: number[]) => {
    const qs =
      definitionIds && definitionIds.length > 0
        ? `?definitionIds=${definitionIds.join(",")}`
        : "";
    return fetch(`/api/collections/stats${qs}`, { credentials: "include" }).then((r) =>
      json<CollectionsStats>(r),
    );
  },
};

export function useCollectionsStats(definitionIds?: number[]) {
  return useQuery({
    queryKey: ["collections-stats", definitionIds ?? []],
    queryFn: () => collectionsApi.getStats(definitionIds),
  });
}

export function usePatientsDefinition() {
  return useQuery({
    queryKey: ["patients-definition"],
    queryFn: async () => {
      const { definitions } = await recordsApi.listDefinitions({ shared: true });
      const def = definitions.find((d) => d.name === PATIENTS_DEFINITION_NAME);
      if (!def) throw new Error("Patients definition not found");
      return def;
    },
  });
}

// Returns the currently active Data Collection (the one shown by default in the
// directory). Falls back to the shared "Patients" collection.
export function useActiveDefinition() {
  return useQuery({
    queryKey: ["active-definition"],
    queryFn: async () => {
      const { definitions } = await recordsApi.listDefinitions({ shared: true });
      const active = definitions.find((d) => d.isActive);
      if (active) return active;
      const fallback = definitions.find((d) => d.name === PATIENTS_DEFINITION_NAME) ?? definitions[0];
      if (!fallback) throw new Error("No data collection available");
      return fallback;
    },
  });
}

// Returns the collection new records are added to: the one explicitly marked as
// default (isDefault), otherwise the "Patients" collection (by name), otherwise
// the first available collection. Considers the user's own AND shared collections.
export function useDefaultDefinition() {
  return useQuery({
    queryKey: ["default-definition"],
    queryFn: async () => {
      const { definitions } = await recordsApi.listDefinitions();
      const def = definitions.find((d) => d.isDefault && !d.deactivated);
      if (def) return def;
      const patients = definitions.find((d) => d.name === PATIENTS_DEFINITION_NAME && !d.deactivated);
      if (patients) return patients;
      const fallback = definitions.find((d) => !d.deactivated);
      if (!fallback) throw new Error("No data collection available");
      return fallback;
    },
  });
}
