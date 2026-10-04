import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormRow } from "@/components/field-row";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/ui/states";
import {
  PatientCombobox,
  usePatientNameMap,
  type PatientOption,
} from "@/components/patient-combobox";
import { ConfirmDestructive } from "@/components/confirm-destructive";

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string })?.error ?? "Request failed");
  }
  return res.json();
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string })?.error ?? "Request failed");
  }
  return res.json();
}

interface ConsentRow {
  id: number;
  patientId: number | string;
  versionLabel?: string;
  versionCode?: string;
  status: "signed" | "withdrawn" | "pending" | string;
  signedAt?: string | null;
  withdrawnAt?: string | null;
  withdrawReason?: string | null;
}

function statusVariant(status: string) {
  if (status === "signed") return "default" as const;
  if (status === "withdrawn") return "destructive" as const;
  return "secondary" as const;
}

function statusLabel(status: string, t: (k: string) => string) {
  if (status === "signed") return t("consent.statusSigned");
  if (status === "withdrawn") return t("consent.statusWithdrawn");
  if (status === "pending") return t("consent.statusPending");
  return status;
}

export default function Consent() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [versionId, setVersionId] = useState("");
  const [patientError, setPatientError] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<{
    id: number;
    name: string;
    reason: string;
  } | null>(null);

  // `patientId` is REQUIRED by the route (it 400s without it), and it also
  // belongs in the query key so switching patients refetches.
  const consents = useQuery({
    queryKey: ["consents", patient?.recordId],
    queryFn: () =>
      getJson(`/api/consent?patientId=${encodeURIComponent(String(patient?.recordId ?? ""))}`),
    enabled: patient?.recordId != null,
  });
  const versions = useQuery({
    queryKey: ["consent-versions"],
    queryFn: () => getJson("/api/consent/versions"),
    staleTime: 60_000,
  });

  const { byRecordId, byPatientId } = usePatientNameMap();

  /** The ledger only returns the numeric patient id — resolve a name for it. */
  function displayName(c: ConsentRow): string {
    const direct = byRecordId.get(Number(c.patientId));
    if (direct) return direct.patientName ?? String(c.patientId);
    const byPid = byPatientId.get(String(c.patientId));
    if (byPid) return byPid.patientName ?? String(c.patientId);
    return t("common.unknown");
  }

  const create = useMutation({
    mutationFn: () =>
      postJson("/api/consent", {
        patientId: Number(patient!.recordId),
        consentVersionId: Number(versionId),
      }),
    onSuccess: () => {
      setVersionId("");
      qc.invalidateQueries({ queryKey: ["consents"] });
      toast({ title: t("consent.statusSigned") });
    },
    onError: (e) =>
      toast({
        title: t("consent.saveFailed"),
        description: (e as Error).message,
        variant: "destructive",
      }),
  });

  const withdraw = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      postJson(`/api/consent/${id}/withdraw`, { reason }),
    onSuccess: () => {
      setWithdrawTarget(null);
      qc.invalidateQueries({ queryKey: ["consents"] });
      toast({ title: t("consent.withdrawn") });
    },
  });

  const rows: ConsentRow[] = consents.data?.consents ?? [];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileCheck className="h-7 w-7 text-primary" /> {t("features.consent.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("consent.subtitle")}</p>
        </div>

        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("consent.recordConsent")}</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!patient) {
                    setPatientError(t("consent.patientRequired"));
                    return;
                  }
                  setPatientError(null);
                  create.mutate();
                }}
              >
                <FormRow
                  label={t("consent.patient")}
                  required
                  markRequired
                  error={patientError ?? undefined}
                  className="min-w-[260px] flex-1"
                  controlClassName="mt-0"
                >
                  <PatientCombobox
                    value={patient}
                    onChange={(v) => {
                      setPatient(v);
                      if (v) setPatientError(null);
                    }}
                    invalid={Boolean(patientError)}
                  />
                </FormRow>
                <FormRow label={t("consent.version")} controlClassName="mt-0">
                  <Select
                    value={versionId}
                    onValueChange={setVersionId}
                  >
                    <SelectTrigger className="min-w-[220px]" aria-label={t("consent.version")}>
                      <SelectValue placeholder={t("consent.versionPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(versions.data?.versions ?? []).map((v: { id: number; label: string; code: string }) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {v.label} ({v.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>
                <Button
                  type="submit"
                  disabled={!patient || !versionId || create.isPending}
                >
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("consent.statusSigned")}
                </Button>
              </form>
              {patient && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("consent.recordConsentFor", {
                    name: patient.patientName ?? t("common.unknown"),
                  })}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("consent.ledger")}
              {patient ? ` · ${patient.patientName ?? patient.patientId ?? patient.recordId}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!patient ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("consent.patient")}
              </p>
            ) : consents.isError ? (
              <ErrorState
                title={t("common.errorTitle")}
                description={t("consent.loadFailed")}
                action={
                  <Button onClick={() => void consents.refetch()}>{t("common.retry")}</Button>
                }
              />
            ) : consents.isLoading ? (
              <div className="flex justify-center py-8" role="status">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <caption className="sr-only">{t("consent.ledger")}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("common.patientId")}</TableHead>
                      <TableHead>{t("consent.patientName")}</TableHead>
                      <TableHead>{t("consent.version")}</TableHead>
                      <TableHead>{t("consent.status")}</TableHead>
                      <TableHead>{t("consent.signedAt")}</TableHead>
                      <TableHead className="text-end">{t("admin.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c: ConsentRow) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.patientId}</TableCell>
                        <TableCell>{displayName(c)}</TableCell>
                        <TableCell>{c.versionLabel || c.versionCode}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(c.status)}>
                            {statusLabel(c.status, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {c.signedAt ? new Date(c.signedAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-end">
                          {canEdit && c.status === "signed" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setWithdrawTarget({
                                  id: c.id,
                                  name: displayName(c),
                                  reason: "",
                                })
                              }
                            >
                              {t("consent.withdraw")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-4 text-center text-muted-foreground"
                        >
                          {t("consent.ledgerEmpty")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Withdrawal is irreversible for the consent record and previously had
          no confirmation at all — one click on "Withdraw" fired the mutation,
          and the reason field was labelled "Optional". */}
      <WithdrawDialog
        target={withdrawTarget}
        onClose={() => setWithdrawTarget(null)}
        onConfirm={async (reason) => {
          if (!withdrawTarget) return;
          await withdraw.mutateAsync({ id: withdrawTarget.id, reason });
        }}
      />
    </Layout>
  );
}

function WithdrawDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: { id: number; name: string; reason: string } | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const reasonError = touched && !reason.trim() ? t("consent.withdrawReasonRequired") : undefined;

  return (
    <ConfirmDestructive
      open={target !== null}
      onOpenChange={(v) => {
        if (!v) {
          setReason("");
          setTouched(false);
          onClose();
        }
      }}
      title={t("consent.withdrawTitle")}
      description={t("consent.withdrawBody", { name: target?.name ?? "" })}
      subject={target?.name}
      confirmLabel={t("consent.withdraw")}
      onConfirm={async () => {
        setTouched(true);
        if (!reason.trim()) {
          // Reject without firing the mutation: a withdrawal with no recorded
          // reason is not auditable.
          throw new Error(t("consent.withdrawReasonRequired"));
        }
        await onConfirm(reason.trim());
        setReason("");
        setTouched(false);
      }}
    >
      <div className="space-y-2">
        <FormRow
          label={t("common.reason")}
          required
          markRequired
          error={reasonError}
          controlClassName="mt-0"
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </FormRow>
      </div>
    </ConfirmDestructive>
  );
}