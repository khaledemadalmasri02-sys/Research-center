import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { cn } from "@/lib/utils";
import { ErrorState, NoPermissionState } from "@/components/ui/states";

async function getJson(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) {
    let message = "";
    try {
      const body = await r.json();
      message = body?.error ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message || `${r.status}`);
  }
  return r.json();
}

/**
 * The Worker erases across four stores (D1, object storage, Postgres, audit)
 * and returns **HTTP 500 for a partial erasure**. An operator must be told the
 * run was INCOMPLETE and RETRYABLE, with the per-store note — not merely
 * "failed", and never silently.
 */
interface ErasureStore {
  store: string;
  ok: boolean;
  expected?: number;
  deleted?: number;
  note?: string;
}

interface ErasureResult {
  ok?: boolean;
  counts?: Record<string, number>;
  stores?: ErasureStore[];
}

interface Candidate {
  patientId: string;
  patientName?: string | null;
  consentCount?: number;
  earliestWithdrawal?: string | null;
  recordCount?: number;
  lastVisit?: string | null;
}

export default function Gdpr() {
  const { t } = useTranslation();
  const { canAdminAccess } = useAuth();
  const qc = useQueryClient();
  const [days, setDays] = useState("365");
  const [candidateRows, setCandidateRows] = useState<Candidate[]>([]);
  const [patientId, setPatientId] = useState("");
  const [last, setLast] = useState<ErasureResult | null>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadRetention = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await getJson(`/api/gdpr/retention?days=${encodeURIComponent(days)}`);
      setCandidateRows((d?.candidates ?? []) as Candidate[]);
      setLoaded(true);
    } catch (e) {
      // Previously this was `.catch(() => ({ candidates: [] }))`, which turned a
      // server failure into "no candidates" — an admin could conclude there
      // was nothing to erase.
      setLoadError((e as Error).message || t("gdpr.loadFailed"));
      setCandidateRows([]);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [days, t]);

  const erase = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/gdpr/erasure/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      let body: unknown = null;
      try {
        body = await r.json();
      } catch {
        /* empty / non-JSON body */
      }
      const parsed = (body ?? {}) as ErasureResult;
      if (!r.ok) {
        const failed = (parsed.stores ?? []).filter((s) => !s.ok);
        const detail = failed.length
          ? failed.map((s) => `${s.store}: ${s.note ?? t("gdpr.storeIncomplete")}`).join("; ")
          : (parsed as { error?: string }).error ?? `${r.status}`;
        const err = new Error(
          `${t("gdpr.eraseIncomplete")} — ${detail}`,
        ) as Error & { stores?: ErasureStore[] };
        err.stores = parsed.stores;
        throw err;
      }
      return parsed;
    },
    onSuccess: (d) => {
      setLast(d);
      setPatientId("");
      setEraseOpen(false);
      qc.invalidateQueries({ queryKey: ["records"] });
      void loadRetention();
    },
  });

  if (!canAdminAccess) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <NoPermissionState
            title={t("common.noPermissionTitle")}
            description={t("common.noPermissionDesc")}
          />
        </div>
      </Layout>
    );
  }

  const chosen = candidateRows.find(
    (c) => String(c.patientId) === String(patientId).trim(),
  );
  const chosenLabel = chosen
    ? `${chosen.patientName || t("common.unknown")} (${chosen.patientId})`
    : patientId.trim()
      ? `${patientId.trim()} (${t("common.unknown")})`
      : "";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" /> {t("features.gdpr.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.gdpr.desc")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("gdpr.candidatesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <FormRow label={t("gdpr.days")} controlClassName="mt-0">
                <Input
                  type="number"
                  min={1}
                  max={36500}
                  step={1}
                  inputMode="numeric"
                  className="w-32"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </FormRow>
              <Button variant="secondary" onClick={() => void loadRetention()} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("gdpr.checkRetention")}
              </Button>
            </div>

            {loadError ? (
              <ErrorState
                title={t("common.errorTitle")}
                description={t("gdpr.loadFailed")}
                action={<Button onClick={() => void loadRetention()}>{t("common.retry")}</Button>}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <caption className="sr-only">{t("gdpr.candidatesTitle")}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("common.patientId")}</TableHead>
                      <TableHead>{t("common.patientName")}</TableHead>
                      <TableHead>{t("common.collection")}</TableHead>
                      <TableHead>{t("gdpr.consents")}</TableHead>
                      <TableHead>{t("gdpr.earliestWithdrawal")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidateRows.map((c) => (
                      <TableRow key={String(c.patientId)}>
                        <TableCell className="font-mono text-xs">{c.patientId}</TableCell>
                        <TableCell>{c.patientName || "—"}</TableCell>
                        <TableCell>{c.recordCount ?? "—"}</TableCell>
                        <TableCell>{c.consentCount ?? "—"}</TableCell>
                        <TableCell>{c.earliestWithdrawal || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!candidateRows.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                          {loaded ? t("gdpr.noCandidates") : ""}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("gdpr.eraseTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <FormRow label={t("common.patientId")} controlClassName="mt-0">
              <Input
                type="number"
                inputMode="numeric"
                className="w-40"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
              />
            </FormRow>
            <Button
              variant="destructive"
              disabled={!patientId.trim() || erase.isPending}
              onClick={() => setEraseOpen(true)}
            >
              {t("gdpr.erase")}
            </Button>
            {last && (
              <div className="w-full text-sm" role="status">
                <p className="font-medium">{t("gdpr.eraseResultTitle")}</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {(last.stores ?? []).map((s) => (
                    <li key={s.store} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "h-2 w-2 rounded-full",
                          s.ok
                            ? "bg-green-600 dark:bg-green-500"
                            : "bg-destructive",
                        )}
                      />
                      <span className="font-mono text-xs">{s.store}</span>
                      <span>
                        {s.ok
                          ? `${s.deleted ?? 0}/${s.expected ?? 0}`
                          : (s.note ?? t("gdpr.eraseIncomplete"))}
                      </span>
                    </li>
                  ))}
                  {!last.stores?.length &&
                    Object.entries(last.counts ?? {}).map(([k, v]) => (
                      <li key={k}>
                        <span className="font-mono text-xs">{k}</span>: {v}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDestructive
        open={eraseOpen}
        onOpenChange={setEraseOpen}
        title={t("gdpr.eraseTitle")}
        description={t("gdpr.confirmBody", { name: chosenLabel || t("common.unknown") })}
        subject={chosenLabel}
        requireText={patientId.trim() || undefined}
        confirmLabel={erase.isPending ? t("gdpr.erasing") : t("gdpr.erase")}
        busyLabel={t("gdpr.erasing")}
        onConfirm={async () => {
          await erase.mutateAsync(patientId.trim());
        }}
      />
    </Layout>
  );
}