import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * ONE saved-view shape for the whole app.
 *
 * Two incompatible shapes existed:
 *   - `records-toolbar.tsx` persisted `{ q }`
 *   - `search.tsx` persisted `{ note: q }`
 * so a view created in one place could not be applied in the other, and
 * neither captured the sex / type filters or the selected collection — a
 * "Male patients" view silently became an unfiltered search on reload.
 *
 * `normalizeSavedView` accepts every historical shape so views saved before
 * this module existed still load.
 */
export interface SavedView {
  id: number;
  name: string;
  /** Collection (record definition) the view was scoped to, if any. */
  collectionId?: number;
  q?: string;
  sex?: string;
  type?: string;
  /** Explicitly-collected field keys to show. */
  fields?: string[];
  /** Wall-clock creation time, when the server provides it. */
  createdAt?: string;
}

export interface SavedViewPayload {
  collectionId?: number;
  q?: string;
  sex?: string;
  type?: string;
  fields?: string[];
}

type RawView = SavedView & {
  filters?: Record<string, unknown> | null;
  definitionId?: number;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

/**
 * Fold every known historical shape into the canonical one.
 * `{ q }`, `{ note: q }`, `{ filters: { q, sex, type } }` all normalise here.
 */
export function normalizeSavedView(raw: RawView): SavedView {
  const filters = (raw.filters ?? {}) as Record<string, unknown>;
  return {
    id: raw.id,
    name: raw.name,
    collectionId: num(raw.collectionId) ?? num(raw.definitionId),
    q: str(raw.q) ?? str(filters.q) ?? str(filters.note) ?? str(filters.query),
    sex: str(raw.sex) ?? str(filters.sex),
    type: str(raw.type) ?? str(filters.type) ?? str(filters.collectionType),
    fields: Array.isArray(raw.fields)
      ? raw.fields.filter((f): f is string => typeof f === "string")
      : undefined,
    createdAt: raw.createdAt,
  };
}

/** Build the POST body for a view. `filters` keeps the server contract. */
export function toSavedViewBody(
  definitionId: number | undefined,
  payload: SavedViewPayload,
  name: string,
) {
  return {
    name,
    definitionId,
    filters: {
      q: payload.q ?? "",
      ...(payload.sex ? { sex: payload.sex } : {}),
      ...(payload.type ? { type: payload.type } : {}),
      ...(payload.fields?.length ? { fields: payload.fields } : {}),
    },
  };
}

async function readError(res: Response, fallback: string): Promise<Error> {
  try {
    const body = await res.json();
    return new Error(body?.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function fetchSavedViews(
  collectionId: number,
  signal?: AbortSignal,
): Promise<{ views: SavedView[] }> {
  const res = await fetch(`/api/saved-views?definitionId=${collectionId}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw await readError(res, "Failed to load views");
  const body = (await res.json()) as { views?: RawView[] };
  return { views: (body.views ?? []).map(normalizeSavedView) };
}

export function useSavedViews(collectionId: number) {
  return useQuery({
    queryKey: ["saved-views", collectionId],
    queryFn: ({ signal }) => fetchSavedViews(collectionId, signal),
    staleTime: 30_000,
  });
}

export function useSaveView(collectionId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, ...payload }: SavedViewPayload & { name: string }) => {
      const res = await fetch("/api/saved-views", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSavedViewBody(collectionId, payload, name)),
      });
      if (!res.ok) throw await readError(res, "Failed to save view");
      return res.json();
    },
    onSuccess: () => {
      if (collectionId != null) {
        qc.invalidateQueries({ queryKey: ["saved-views", collectionId] });
      }
    },
  });
}

export function useDeleteView(collectionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/saved-views/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw await readError(res, "Failed to delete view");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-views", collectionId] }),
  });
}

/** Human summary of what a view will filter on, for the menu + a11y label. */
export function describeView(
  view: SavedView,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  if (view.q) parts.push(`“${view.q}”`);
  if (view.sex && view.sex !== "all") parts.push(t("savedViews.includingSex", { value: view.sex }));
  if (view.type && view.type !== "all") parts.push(t("savedViews.includingType", { value: view.type }));
  return parts.join(" · ");
}