import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2, Upload, X } from "lucide-react";
import { uploadImage, imageUrl } from "@/lib/upload";
import type { FieldDef, RecordDefinition } from "@/lib/records";

interface RecordFormProps {
  definition: RecordDefinition;
  initialData?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
}

export function RecordForm({ definition, initialData, onSubmit, onCancel, submitting }: RecordFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of definition.fields) {
      if (f.type === "image") init[f.key] = Array.isArray(initialData?.[f.key]) ? (initialData![f.key] as string[]) : [];
      else init[f.key] = initialData?.[f.key] ?? (f.type === "number" ? "" : "");
    }
    return init;
  });
  const [uploading, setUploading] = useState(false);

  function setField(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
  }

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
      alert((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function removeImage(field: FieldDef, key: string) {
    setField(field.key, (values[field.key] as string[]).filter((k) => k !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: Record<string, unknown> = {};
    for (const f of definition.fields) data[f.key] = values[f.key];
    await onSubmit(data);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{definition.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {definition.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">This collection has no fields defined yet.</p>
          )}
          {definition.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </Label>

              {field.type === "textarea" && (
                <Textarea
                  id={field.key}
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}

              {field.type === "text" && (
                <Input
                  id={field.key}
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}

              {field.type === "number" && (
                <Input
                  id={field.key}
                  type="number"
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}

              {field.type === "date" && (
                <Input
                  id={field.key}
                  type="date"
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}

              {field.type === "select" && (
                <select
                  id={field.key}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                >
                  <option value="">— select —</option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              {field.type === "image" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(values[field.key] as string[]).map((key) => (
                      <div key={key} className="relative w-24 h-24 rounded-md border overflow-hidden group">
                        <img src={imageUrl(key)} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeImage(field, key)}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-primary border border-dashed border-input rounded-md px-3 py-2 hover:bg-secondary">
                    <Upload className="h-4 w-4" />
                    {uploading ? "Uploading…" : "Add image"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => handleFiles(field, e.target.files)}
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || uploading}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting ? "Saving…" : "Save record"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
