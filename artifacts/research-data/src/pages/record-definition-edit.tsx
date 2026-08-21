import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, Save, ArrowUp, ArrowDown, GripVertical, Type, Hash, Calendar, List, AlignLeft, Image as ImageIcon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recordsApi, type FieldDef } from "@/lib/records";

const FIELD_TYPES: { value: FieldDef["type"]; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "number", label: "Number", icon: Hash },
  { value: "date", label: "Date", icon: Calendar },
  { value: "select", label: "Select", icon: List },
  { value: "textarea", label: "Long text", icon: AlignLeft },
  { value: "image", label: "Image", icon: ImageIcon },
];

function fieldIcon(type: FieldDef["type"]) {
  return FIELD_TYPES.find((t) => t.value === type)?.icon ?? Type;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function makeUniqueKey(label: string, fields: FieldDef[], selfIndex: number): string {
  let base = slugify(label) || `field_${selfIndex + 1}`;
  const taken = new Set(
    fields
      .filter((_, i) => i !== selfIndex)
      .map((f) => f.key)
      .filter(Boolean),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function FieldPreview({ field }: { field: FieldDef }) {
  const Icon = fieldIcon(field.type);
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {field.label || "Untitled field"}
        {field.required && <span className="text-destructive"> *</span>}
      </Label>
      {field.type === "textarea" ? (
        <Textarea disabled placeholder="Long text…" />
      ) : field.type === "select" ? (
        <Select disabled>
          <SelectTrigger><SelectValue placeholder="— select —" /></SelectTrigger>
        </Select>
      ) : field.type === "image" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground border border-dashed rounded-md px-3 py-2">
          <ImageIcon className="h-4 w-4" /> Image upload
        </div>
      ) : (
        <Input disabled type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} placeholder={field.label} />
      )}
    </div>
  );
}

export default function RecordDefinitionEdit() {
  const { id } = useParams();
  const definitionId = id ? Number(id) : undefined;
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["record-definition", definitionId],
    queryFn: () => recordsApi.getDefinition(definitionId!),
    enabled: !!definitionId,
  });

  useEffect(() => {
    if (data?.definition) {
      setName(data.definition.name);
      setFields(data.definition.fields ?? []);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (definitionId) return recordsApi.updateDefinition(definitionId, { name, fields });
      return recordsApi.createDefinition(name, fields);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
      navigate("/collections");
    },
  });

  function updateField(index: number, patch: Partial<FieldDef>) {
    setFields((fs) => fs.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function addField() {
    setFields((fs) => [...fs, { key: "", label: "", type: "text", required: false }]);
  }

  function move(index: number, dir: -1 | 1) {
    setFields((fs) => {
      const next = [...fs];
      const target = index + dir;
      if (target < 0 || target >= next.length) return fs;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const seenKeys = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const f of fields) {
    if (!f.key) continue;
    if (seenKeys.has(f.key)) duplicateKeys.push(f.key);
    seenKeys.add(f.key);
  }
  const emptyKeyCount = fields.filter((f) => !f.key).length;
  const hasKeyProblem = duplicateKeys.length > 0 || emptyKeyCount > 0;

  if (definitionId && isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {definitionId ? "Edit Collection" : "New Collection"}
          </h1>
          <p className="text-muted-foreground mt-1">Define the fields users will fill in for each record.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Collection details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="coll-name" className="text-xs">Name</Label>
                <Input
                  id="coll-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Research Samples"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Fields ({fields.length})</CardTitle>
                <Button size="sm" variant="outline" onClick={addField}>
                  <Plus className="h-4 w-4 mr-1" /> Add field
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {fields.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
                    <p className="text-sm">No fields yet. Add one to get started.</p>
                  </div>
                )}
                {fields.map((field, index) => {
                  const Icon = fieldIcon(field.type);
                  return (
                    <div key={index} className="rounded-lg border bg-card p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground/40" />
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium flex-1 truncate">{field.label || "Untitled field"}</span>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === 0} onClick={() => move(index, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === fields.length - 1} onClick={() => move(index, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setFields((fs) => fs.filter((_, i) => i !== index))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-5 space-y-1">
                          <Label className="text-xs">Label</Label>
                          <Input
                            value={field.label}
                            onChange={(e) => {
                              const label = e.target.value;
                              updateField(index, { label, key: field.key || makeUniqueKey(label, fields, index) });
                            }}
                          />
                        </div>
                        <div className="col-span-4 space-y-1">
                          <Label className="text-xs">Key</Label>
                          <Input
                            value={field.key}
                            onChange={(e) => updateField(index, { key: makeUniqueKey(e.target.value, fields, index) })}
                            placeholder="field_key"
                          />
                        </div>
                        <div className="col-span-3 space-y-1">
                          <Label className="text-xs">Type</Label>
                          <Select
                            value={field.type}
                            onValueChange={(v) => updateField(index, { type: v as FieldDef["type"] })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  <span className="flex items-center gap-2">
                                    <t.icon className="h-3.5 w-3.5" /> {t.label}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {field.type === "select" && (
                        <div className="space-y-1">
                          <Label className="text-xs">Options (comma separated)</Label>
                          <Input
                            value={(field.options ?? []).join(", ")}
                            onChange={(e) =>
                              updateField(index, {
                                options: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder="A, B, C"
                          />
                          <div className="flex flex-wrap gap-1">
                            {(field.options ?? []).map((o) => (
                              <Badge key={o} variant="secondary" className="text-xs">{o}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      <Separator />
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            checked={!!field.required}
                            onCheckedChange={(v) => updateField(index, { required: v })}
                          />
                          Required field
                        </label>
                        <Badge variant="outline" className="text-xs">{field.type}</Badge>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {hasKeyProblem && (
              <p className="text-sm text-destructive">
                {emptyKeyCount > 0
                  ? "Every field needs a label (it generates the key)."
                  : `Duplicate field key(s): ${[...new Set(duplicateKeys)].join(", ")}. Keys must be unique.`}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !name || hasKeyProblem}
              >
                <Save className="h-4 w-4 mr-1" />
                {saveMutation.isPending ? "Saving…" : "Save collection"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/collections")}>
                Cancel
              </Button>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Live preview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">How the form will look for each record.</p>
                  {fields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Add fields to see a preview.</p>
                  ) : (
                    fields.map((f, i) => <FieldPreview key={i} field={f} />)
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
