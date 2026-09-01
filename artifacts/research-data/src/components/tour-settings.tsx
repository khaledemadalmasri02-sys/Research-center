import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, Film, Sparkles, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TOUR_STEPS } from "@/hooks/use-product-tour";
import { fetchTourConfig, type TourConfig, type TourStepConfig, type TourSource } from "@/lib/tour-config";

function effectiveSource(draft: TourConfig, key: string): TourSource {
  return draft.steps[key]?.source ?? draft.defaultSource;
}

export function TourSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TourConfig | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const query = useQuery<TourConfig>({
    queryKey: ["tour-config-admin"],
    queryFn: ({ signal }) => fetchTourConfig(signal),
  });

  // Seed local draft once config loads.
  if (query.data && !draft) {
    setDraft(JSON.parse(JSON.stringify(query.data)));
  }

  const saveMutation = useMutation({
    mutationFn: async (cfg: TourConfig) => {
      const res = await fetch("/api/tour-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tour-config-admin"] });
      qc.invalidateQueries({ queryKey: ["tour-config"] });
    },
  });

  async function uploadScreen(key: string, file: File) {
    try {
      setUploading(key);
      const ext = file.name.split(".").pop() || "mp4";
      const res = await fetch(`/api/tour-config/screen?step=${encodeURIComponent(key)}&ext=${encodeURIComponent(ext)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "video/mp4" },
        body: file,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error ?? "Upload failed");
      }
      const { url } = (await res.json()) as { url: string };
      setDraft((d) =>
        d
          ? {
              ...d,
              steps: {
                ...d.steps,
                [key]: { ...d.steps[key], source: "screen", screenUrl: url } as TourStepConfig,
              },
            }
          : d,
      );
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  if (query.isLoading || !draft) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const setGlobal = (source: TourSource) => setDraft((d) => (d ? { ...d, defaultSource: source } : d));

  const setStepSource = (key: string, value: "default" | TourSource) => {
    setDraft((d) => {
      if (!d) return d;
      const steps = { ...d.steps };
      if (value === "default") {
        const { source: _drop, ...rest } = steps[key] ?? {};
        if (Object.keys(rest).length === 0) delete steps[key];
        else steps[key] = rest as TourStepConfig;
      } else {
        steps[key] = { ...steps[key], source: value };
      }
      return { ...d, steps };
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Film className="h-4 w-4" /> Product Tour Videos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Default video source:</span>
          <Select value={draft.defaultSource} onValueChange={(v) => setGlobal(v as TourSource)}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="animated">
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> Animated explainer
                </span>
              </SelectItem>
              <SelectItem value="screen">
                <span className="flex items-center gap-2">
                  <Film className="h-4 w-4" /> Screen recording
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-muted-foreground">
          Choose whether the tour plays the generated animated explainer or a real screen recording for each step.
          Upload a screen recording per step below, then set its source to 'Screen recording'.
        </p>

        <div className="border rounded-md divide-y">
          {TOUR_STEPS.map((s) => {
            const key = s.key;
            const stepCfg = draft.steps[key];
            const source = stepCfg?.source ?? "default";
            const eff = effectiveSource(draft, key);
            const screenUrl = stepCfg?.screenUrl;
            return (
              <div key={key} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="w-40 shrink-0 font-medium text-sm">{t(`tour.steps.${key}.title`)}</div>
                <Select value={source} onValueChange={(v) => setStepSource(key, v as "default" | TourSource)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Use global ({draft.defaultSource})</SelectItem>
                    <SelectItem value="animated">Animated explainer</SelectItem>
                    <SelectItem value="screen">Screen recording</SelectItem>
                  </SelectContent>
                </Select>

                {eff === "screen" && (
                  <div className="flex items-center gap-3 flex-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs border rounded-md px-2 py-1 hover:bg-secondary">
                      <Upload className="h-4 w-4" />
                      {uploading === key ? "Uploading…" : "Upload screen video"}
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadScreen(key, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {screenUrl ? (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <Check className="h-3.5 w-3.5" /> uploaded
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">no clip yet (uses placeholder)</span>
                    )}
                    {screenUrl && (
                      <video src={screenUrl} controls className="h-10 rounded border" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save settings"}
          </Button>
          {saveMutation.isSuccess && <span className="text-sm text-green-600">Saved.</span>}
          {saveMutation.isError && (
            <span className="text-sm text-destructive">{(saveMutation.error as Error).message}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
