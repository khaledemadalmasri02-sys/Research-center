import { useState, useEffect, useId, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormRow } from "@/components/field-row";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, Save, ArrowUp, ArrowDown, Type, Hash, Calendar, List, AlignLeft, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";

/** Module-level so uids are unique across mounts within a session. */
let nextUid = 1;
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recordsApi, type FieldDef } from "@/lib/records";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

const FIELD_TYPES: { value: FieldDef["type"]; labelKey: string; icon: typeof Type }[] = [
  { value: "text", labelKey: "recordDef.fieldTypeText", icon: Type },
  { value: "number", labelKey: "recordDef.fieldTypeNumber", icon: Hash },
  { value: "date", labelKey: "recordDef.fieldTypeDate", icon: Calendar },
  { value: "select", labelKey: "recordDef.fieldTypeSelect", icon: List },
  { value: "textarea", labelKey: "recordDef.fieldTypeTextarea", icon: AlignLeft },
  { value: "image", labelKey: "recordDef.fieldTypeImage", icon: ImageIcon },
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
  const { t } = useTranslation();
  const Icon = fieldIcon(field.type);
  const label = field.label || t("recordDef.untitledField");
  const controlId = useId();
  return (
    <div className="space-y-1.5">
      {/*
        The preview controls are `disabled`, so a `<label htmlFor>` would name a
        control the user can never reach. The name is attached to the group
        instead: `aria-labelledby` on the wrapper names both the heading and the
        inert control below it, which is what a screen-reader user actually
        needs to understand the preview.
      */}
      <span
        id={`${controlId}-label`}
        className="flex items-center gap-1.5 text-sm font-medium leading-none text-muted-foreground"
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
        {field.required && (
          <span className="text-destructive">
            {" "}*<span className="sr-only"> ({t("common.required")})</span>
          </span>
        )}
      </span>
      <div role="group" aria-labelledby={`${controlId}-label`}>
        {field.type === "textarea" ? (
          <Textarea disabled placeholder={t("recordDef.phLongText")} aria-label={label} />
        ) : field.type === "select" ? (
          <Select disabled>
            <SelectTrigger aria-label={label}>
              <SelectValue placeholder={t("recordDef.phSelect")} />
            </SelectTrigger>
          </Select>
        ) : field.type === "image" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground border border-dashed rounded-md px-3 py-2">
            <ImageIcon className="h-4 w-4" aria-hidden /> {t("recordDef.imageUpload")}
          </div>
        ) : (
          <Input
            disabled
            type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
            placeholder={field.label}
            aria-label={label}
          />
        )}
      </div>
    </div>
  );
}

export default function RecordDefinitionEdit() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { id } = useParams();
  const definitionId = id ? Number(id) : undefined;
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const initialRef = useRef<{ name: string; fields: FieldDef[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);

  const { data, isLoading } = useQuery({
    queryKey: ["record-definition", definitionId],
    queryFn: () => recordsApi.getDefinition(definitionId!),
    enabled: !!definitionId,
  });

  useEffect(() => {
    if (data?.definition) {
      setName(data.definition.name);
      const hydrated = withUids(data.definition.fields ?? []);
      setFields(hydrated as FieldDef[]);
      initialRef.current = {
        name: data.definition.name,
        fields: data.definition.fields ?? [],
      };
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    const init = initialRef.current;
    if (!init) return;
    const sameName = init.name === name;
    const sameFields = JSON.stringify(init.fields) === JSON.stringify(fields);
    setDirty(!(sameName && sameFields));
  }, [name, fields]);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Strip the generated `_uid` before it reaches the API.
      const payload = fields.map((f) => {
        const { _uid, ...rest } = f as FieldDef & { _uid?: string };
        return rest as FieldDef;
      });
      if (definitionId) return recordsApi.updateDefinition(definitionId, { name, fields: payload });
      return recordsApi.createDefinition(name, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
      toast({ title: t("records.updated") });
      navigate("/collections");
    },
    onError: (e) =>
      toast({
        title: t("destructive.failed"),
        description: (e as Error).message || t("common.unknown"),
        variant: "destructive",
      }),
  });

  /**
   * Give every field a stable React key. The list is reorderable (move up /
   * move down) and removable, so `key={index}` reused the wrong DOM node after
   * a move — an input kept the previous field's value.
   */
  function withUids(list: FieldDef[]): (FieldDef & { _uid: string })[] {
    return list.map((f, i) => ({
      ...f,
      _uid: (f as FieldDef & { _uid?: string })._uid ?? `field-${nextUid++}`,
    })) as (FieldDef & { _uid: string })[];
  }

  function updateField(index: number, patch: Partial<FieldDef>) {
    setFields((fs) => fs.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  const uidOf = (index: number) =>
    (fields[index] as (FieldDef & { _uid?: string }) | undefined)?._uid ?? `field-${index}`;

  function addField() {
    setFields((fs) => [
      ...fs,
      { key: "", label: "", type: "text", required: false, _uid: `field-${nextUid++}` } as FieldDef,
    ]);
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
            {definitionId ? t("app.editCollection") : t("app.newCollection")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("recordDef.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">{t("recordDef.detailsTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="coll-name" className="text-xs">{t("recordDef.nameLabel")}</Label>
                <Input
                  id="coll-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("recordDef.phName")}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {t("recordDef.fieldsTitle", { count: fields.length })}
                </CardTitle>
                <Button size="sm" variant="outline" onClick={addField}>
                  <Plus className="h-4 w-4 me-1" aria-hidden /> {t("recordDef.addField")}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {fields.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
                    <p className="text-sm">{t("recordDef.noFields")}</p>
                  </div>
                )}
                {fields.map((field, index) => {
                  const Icon = fieldIcon(field.type);
                  return (
                    /* Keyed by a stable uid: `key={index}` reused the wrong DOM
                     * node after a move or removal, so an Arrow-up could carry
                     * the previous field's input state with it. */
                    <div key={uidOf(index)} className="rounded-lg border bg-card p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" aria-hidden />
                        <span className="flex-1 truncate text-sm font-medium">
                          {field.label || t("recordDef.untitledField")}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={index === 0}
                            aria-label={t("recordDef.moveUp", { label: field.label || index + 1 })}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={index === fields.length - 1}
                            aria-label={t("recordDef.moveDown", { label: field.label || index + 1 })}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            aria-label={t("recordDef.deleteField", { label: field.label || index + 1 })}
                            onClick={() => setFields((fs) => fs.filter((_, i) => i !== index))}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-5 space-y-1">
                          <FormRow label={t("recordDef.label")} labelClassName="text-xs" controlClassName="mt-0">
                          <Input
                            value={field.label}
                            onChange={(e) => {
                              const label = e.target.value;
                              updateField(index, { label, key: field.key || makeUniqueKey(label, fields, index) });
                            }}
                          />
                          </FormRow>
                        </div>
                        <div className="col-span-4 space-y-1">
                          <FormRow label={t("recordDef.key")} labelClassName="text-xs" controlClassName="mt-0">
                          <Input
                            value={field.key}
                            onChange={(e) => updateField(index, { key: makeUniqueKey(e.target.value, fields, index) })}
                            placeholder={t("recordDef.phKey")}
                          />
                          </FormRow>
                        </div>
                        <div className="col-span-3 space-y-1">
                          <FormRow label={t("recordDef.type")} labelClassName="text-xs" controlClassName="mt-0">
                          <Select
                            value={field.type}
                            onValueChange={(v) => updateField(index, { type: v as FieldDef["type"] })}
                          >
                            <SelectTrigger aria-label={t("recordDef.type")}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {/* `ft`, not `t`: the map parameter used to shadow
                                  the `t()` translator. */}
                              {FIELD_TYPES.map((ft) => (
                                <SelectItem key={ft.value} value={ft.value}>
                                  <span className="flex items-center gap-2">
                                    <ft.icon className="h-3.5 w-3.5" aria-hidden />{" "}
                                    {t(ft.labelKey)}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          </FormRow>
                        </div>
                      </div>

                      {field.type === "select" && (
                        <div className="space-y-1">
                          <FormRow label={t("recordDef.options")} labelClassName="text-xs" controlClassName="mt-0">
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
                            placeholder={t("recordDef.phOptions")}
                          />
                          </FormRow>
                          <div className="mt-1 flex flex-wrap gap-1">
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
                            id={`${uidOf(index)}-required`}
                            checked={!!field.required}
                            onCheckedChange={(v) => updateField(index, { required: v })}
                          />
                          {t("recordDef.requiredField")}
                        </label>
                        <Badge variant="outline" className="text-xs">{field.type}</Badge>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Blocking validation, so it is announced rather than only coloured. */}
            {hasKeyProblem && (
              <p role="alert" className="text-sm text-destructive">
                {emptyKeyCount > 0
                  ? t("recordDef.errKeyRequired")
                  : t("recordDef.errKeyDuplicate", { keys: [...new Set(duplicateKeys)].join(", ") })}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !name || hasKeyProblem}
              >
                <Save className="h-4 w-4 me-1" aria-hidden />
                {saveMutation.isPending ? t("common.saving") : t("recordDef.save")}
              </Button>
              <Button variant="outline" onClick={() => navigate("/collections")}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">{t("recordDef.livePreview")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">{t("recordDef.livePreviewDesc")}</p>
                  {fields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("recordDef.previewEmpty")}</p>
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
