import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { uploadImage, imageUrl } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";
import { FormRow, selectClassName } from "@/components/field-row";
import type { FieldDef, RecordDefinition } from "@/lib/records";

interface RecordFormProps {
  definition: RecordDefinition;
  initialData?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
  /** Called whenever the user changes a field. Use it to drive an
   *  `useUnsavedChanges(dirty)` guard on the surrounding page. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function RecordForm({ definition, initialData, onSubmit, onCancel, submitting, onDirtyChange }: RecordFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of definition.fields) {
      if (f.type === "image") init[f.key] = Array.isArray(initialData?.[f.key]) ? (initialData![f.key] as string[]) : [];
      else init[f.key] = initialData?.[f.key] ?? (f.type === "number" ? "" : "");
    }
    return init;
  });
  const initialRef = useRef(values);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  function setField(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  useEffect(() => {
    if (!onDirtyChange) return;
    const dirty = JSON.stringify(values) !== JSON.stringify(initialRef.current);
    onDirtyChange(dirty);
  }, [values, onDirtyChange]);

  async function handleFiles(field: FieldDef, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const keys: string[] = [];
      for (const file of Array.from(files)) {
        const key = await uploadImage(file);
        keys.push(key);
      }
      setField(field.key, [...(values[field.key] as string[]), ...keys]);
    } catch (err) {
      // Previously a raw, untranslated `window.alert`. In-app + dismissible.
      toast({
        title: t("patientForm.uploadFailed"),
        description: (err as Error).message || t("common.unknown"),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  function removeImage(field: FieldDef, key: string) {
    setField(field.key, (values[field.key] as string[]).filter((k) => k !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // `field.required` used to render a bare `*` with no enforcement: a
    // completely empty record could be saved.
    const next: Record<string, string> = {};
    for (const f of definition.fields) {
      if (!f.required) continue;
      const v = values[f.key];
      const empty = Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim();
      if (empty) {
        next[f.key] = t("patientForm.requiredField", { label: f.label });
      }
    }
    setErrors(next);
    setShowErrors(true);
    if (Object.keys(next).length > 0) {
      window.requestAnimationFrame(() => {
        document.getElementById("record-form-error-summary")?.focus();
      });
      return;
    }

    const data: Record<string, unknown> = {};
    for (const f of definition.fields) data[f.key] = values[f.key];
    await onSubmit(data);
  }

  /** One control per field type, so `FormRow` can wire label/control/aria. */
  function renderControl(field: FieldDef): React.ReactElement {
    const onChange = (v: string) => setField(field.key, v);
    const common = {
      value: (values[field.key] as string) ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        onChange(e.target.value),
    };

    switch (field.type) {
      case "textarea":
        return <Textarea {...common} />;
      case "number":
        return <Input {...common} type="number" inputMode="numeric" />;
      case "date":
        return <Input {...common} type="date" />;
      case "select":
        return (
          <select className={selectClassName} value={(values[field.key] as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">{t("patientForm.selectOption")}</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case "image":
        return (
          <div className="space-y-2">
            <ul className="flex flex-wrap gap-2">
              {(values[field.key] as string[]).map((key) => (
                <li key={key} className="relative w-24 h-24 rounded-md border overflow-hidden group">
                  <img
                    src={imageUrl(key)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(field, key)}
                    aria-label={t("patientForm.removeImage")}
                    className="absolute top-1 end-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-primary border border-dashed border-input rounded-md px-3 py-2 hover:bg-secondary">
              <Upload className="h-4 w-4" />
              {uploading ? t("patientForm.uploading") : t("patientForm.addImage")}
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={uploading}
                onChange={(e) => handleFiles(field, e.target.files)}
              />
            </label>
          </div>
        );
      default:
        return <Input {...common} />;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {showErrors && Object.keys(errors).length > 0 && (
        <div
          id="record-form-error-summary"
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-destructive bg-destructive/5 p-4 outline-none"
        >
          <h2 className="font-semibold text-destructive">
            {t("patientForm.errorSummaryTitle", { count: Object.keys(errors).length })}
          </h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
            {Object.entries(errors).map(([key, message]) => (
              <li key={key}>
                <a href={`#${key}`} className="underline underline-offset-2">
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{definition.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {definition.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("analysis.noDatasets")}</p>
          )}
          {definition.fields.map((field) => (
            <div key={field.key} className="space-y-1.5" id={field.key}>
              <FormRow
                label={field.label}
                required={field.required}
                markRequired={field.required}
                error={showErrors ? errors[field.key] : undefined}
                labelClassName="text-sm font-medium text-foreground"
              >
                {renderControl(field)}
              </FormRow>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || uploading}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting ? t("patientForm.savingRecord") : t("patientForm.saveRecord")}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
