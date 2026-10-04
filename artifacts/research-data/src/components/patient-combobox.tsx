import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PATIENTS_DEFINITION_NAME, recordsApi } from "@/lib/records";
import { ErrorState } from "@/components/ui/states";

export interface PatientOption {
  /** Record row id — what the consent / image APIs key on. */
  recordId: number;
  /** Human-facing record id from the record data. */
  patientId?: string;
  patientName?: string;
}

const MAX_RESULTS = 50;

/**
 * Searchable patient picker.
 *
 * Replaces the free-typed numeric "Patient ID" input that consent (and image
 * import) used. Free typing meant a consent could be filed against a wrong or
 * nonexistent id, and nobody could tell which patient a consent row belonged
 * to once it was in the ledger.
 */
export function PatientCombobox({
  value,
  onChange,
  placeholder,
  invalid,
  describedBy,
  disabled,
  className,
}: {
  value: PatientOption | null;
  onChange: (v: PatientOption | null) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");

  const { data: collections, isError: defsError, refetch: refetchDefs } = useQuery({
    queryKey: ["collections-list"],
    queryFn: () => recordsApi.listDefinitions(),
    staleTime: 60_000,
  });
  const patientsDefId = React.useMemo(
    () => (collections?.definitions ?? []).find((d) => d.name === PATIENTS_DEFINITION_NAME)?.id,
    [collections],
  );

  const records = useQuery({
    queryKey: ["records", patientsDefId, "directory"],
    queryFn: () => recordsApi.listRecords(patientsDefId),
    enabled: patientsDefId != null,
    staleTime: 30_000,
  });

  const options = React.useMemo<PatientOption[]>(() => {
    const list = records.data?.records ?? [];
    const all = list.map((r) => {
      const d = r.data as Record<string, unknown>;
      return {
        recordId: r.id,
        patientId: typeof d.patientId === "string" ? d.patientId : undefined,
        patientName: typeof d.patientName === "string" ? d.patientName : undefined,
      } satisfies PatientOption;
    });
    const q = term.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (o) =>
            (o.patientId ?? "").toLowerCase().includes(q) ||
            (o.patientName ?? "").toLowerCase().includes(q),
        )
      : all;
    return filtered.slice(0, MAX_RESULTS);
  }, [records.data, term]);

  const listId = React.useId();

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span className="truncate">
                {value.patientName ?? t("common.unknown")}{" "}
                <span className="text-muted-foreground">({value.patientId ?? value.recordId})</span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                {placeholder ?? t("consent.patientPlaceholder")}
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t("consent.patientPlaceholder")}
                aria-label={t("consent.patientPlaceholder")}
                className="ps-8"
              />
            </div>
          </div>

          {defsError || records.isError ? (
            <div className="p-2">
              <ErrorState
                size="sm"
                title={t("common.errorTitle")}
                description={t("consent.loadFailed")}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void refetchDefs();
                      void records.refetch();
                    }}
                  >
                    {t("common.retry")}
                  </Button>
                }
              />
            </div>
          ) : records.isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : options.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("consent.patientNotFound")}</p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
              {options.map((o) => {
                const selected = value?.recordId === o.recordId;
                return (
                  <li key={o.recordId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(o);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-accent",
                        selected && "bg-accent",
                      )}
                    >
                      <Check
                        aria-hidden
                        className={cn("h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {o.patientName ?? t("common.unknown")}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {o.patientId ?? o.recordId}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Resolve the patient name for a consent row. The ledger API returns only the
 * numeric `patientId`, which is not auditable on its own.
 */
export function usePatientNameMap() {
  const { data: collections } = useQuery({
    queryKey: ["collections-list"],
    queryFn: () => recordsApi.listDefinitions(),
    staleTime: 60_000,
  });
  const patientsDefId = React.useMemo(
    () => (collections?.definitions ?? []).find((d) => d.name === PATIENTS_DEFINITION_NAME)?.id,
    [collections],
  );
  const records = useQuery({
    queryKey: ["records", patientsDefId, "directory"],
    queryFn: () => recordsApi.listRecords(patientsDefId),
    enabled: patientsDefId != null,
    staleTime: 30_000,
  });

  return React.useMemo(() => {
    const byRecordId = new Map<number, PatientOption>();
    const byPatientId = new Map<string, PatientOption>();
    for (const r of records.data?.records ?? []) {
      const d = r.data as Record<string, unknown>;
      const opt: PatientOption = {
        recordId: r.id,
        patientId: typeof d.patientId === "string" ? d.patientId : undefined,
        patientName: typeof d.patientName === "string" ? d.patientName : undefined,
      };
      byRecordId.set(r.id, opt);
      if (opt.patientId) byPatientId.set(opt.patientId, opt);
    }
    return { byRecordId, byPatientId, isLoading: records.isLoading };
  }, [records.data, records.isLoading]);
}