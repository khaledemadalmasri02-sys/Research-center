import { Boxes, Download, Loader2, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalysisOptions, AnalysisVariable } from "./types";
import { ANALYSIS_TYPES } from "./options";
import { VarSelect, VariableMultiSelect } from "./VariableSelect";

interface AnalysisBuilderProps {
  variables: AnalysisVariable[];
  analysisType: string;
  opts: AnalysisOptions;
  setAnalysisType: (t: string) => void;
  setOpts: (o: AnalysisOptions) => void;
  busy: boolean;
  hasResult: boolean;
  resultId?: number;
  onRun: () => void;
  onExportRun: () => void;
}

export function AnalysisBuilder({
  variables,
  analysisType,
  opts,
  setAnalysisType,
  setOpts,
  busy,
  hasResult,
  resultId,
  onRun,
  onExportRun,
}: AnalysisBuilderProps) {
  const { t } = useTranslation();
  const scaleVars = variables.filter((v) => v.measure === "scale");
  const catVars = variables.filter((v) => v.measure !== "scale");
  const allVars = variables;

  const setOpt = (k: string, v: unknown) => setOpts({ ...opts, [k]: v });
  const toggleMulti = (k: string, name: string) => {
    const cur = (opts[k] as string[] | undefined) ?? [];
    setOpt(
      k,
      cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name],
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" /> {t("analysis.runAnalysis")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 max-w-xs">
          <Label>{t("analysis.analysisType")}</Label>
          <Select
            value={analysisType}
            onValueChange={(ty) => {
              setAnalysisType(ty);
              // The default options for the new type — see options.ts.
              // The parent component owns the opts state and re-initialises
              // it via setOpts; we do not import defaultOpts here to keep
              // the builder ignorant of the catalogue.
              setOpts({});
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANALYSIS_TYPES.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {analysisType === "descriptive" && (
            <VarSelect
              label={t("analysis.variable")}
              vars={scaleVars}
              value={opts.variable as string}
              onChange={(v) => setOpt("variable", v)}
            />
          )}

          {analysisType === "ttest" && (
            <>
              <div className="space-y-1">
                <Label>{t("analysis.mode")}</Label>
                <Select value={opts.mode as string} onValueChange={(m) => setOpt("mode", m)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="independent">{t("analysis.independent")}</SelectItem>
                    <SelectItem value="paired">{t("analysis.paired")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {opts.mode === "paired" ? (
                <>
                  <VarSelect label={t("analysis.pairedA")} vars={allVars} value={opts.pairedA as string} onChange={(v) => setOpt("pairedA", v)} />
                  <VarSelect label={t("analysis.pairedB")} vars={allVars} value={opts.pairedB as string} onChange={(v) => setOpt("pairedB", v)} />
                </>
              ) : (
                <>
                  <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent as string} onChange={(v) => setOpt("dependent", v)} />
                  <VarSelect label={t("analysis.groupVariable")} vars={catVars} value={opts.groupVariable as string} onChange={(v) => setOpt("groupVariable", v)} />
                  <div className="space-y-1">
                    <Label>{t("analysis.groupA")}</Label>
                    <Input value={(opts.groupA as string) ?? ""} onChange={(e) => setOpt("groupA", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("analysis.groupB")}</Label>
                    <Input value={(opts.groupB as string) ?? ""} onChange={(e) => setOpt("groupB", e.target.value)} />
                  </div>
                  <div className="flex items-end gap-2">
                    <input
                      type="checkbox"
                      id="eqvar"
                      checked={!!opts.equalVariance}
                      onChange={(e) => setOpt("equalVariance", e.target.checked)}
                    />
                    <Label htmlFor="eqvar">{t("analysis.equalVariance")}</Label>
                  </div>
                </>
              )}
            </>
          )}

          {analysisType === "anova" && (
            <>
              <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent as string} onChange={(v) => setOpt("dependent", v)} />
              <VarSelect label={t("analysis.group")} vars={catVars} value={opts.group as string} onChange={(v) => setOpt("group", v)} />
            </>
          )}

          {analysisType === "chisquare" && (
            <>
              <VarSelect label={t("analysis.row")} vars={allVars} value={opts.row as string} onChange={(v) => setOpt("row", v)} />
              <VarSelect label={t("analysis.column")} vars={allVars} value={opts.column as string} onChange={(v) => setOpt("column", v)} />
            </>
          )}

          {analysisType === "correlation" && (
            <>
              <div className="space-y-1">
                <Label>{t("analysis.method")}</Label>
                <Select value={opts.method as string} onValueChange={(m) => setOpt("method", m)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pearson">Pearson</SelectItem>
                    <SelectItem value="spearman">Spearman</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <VariableMultiSelect
                label={t("analysis.variables")}
                vars={allVars}
                selected={(opts.variables as string[]) ?? []}
                onToggle={(n) => toggleMulti("variables", n)}
              />
            </>
          )}

          {analysisType === "regression" && (
            <>
              <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent as string} onChange={(v) => setOpt("dependent", v)} />
              <VariableMultiSelect
                label={t("analysis.independent")}
                vars={scaleVars}
                selected={(opts.independent as string[]) ?? []}
                onToggle={(n) => toggleMulti("independent", n)}
              />
              <div className="flex items-end gap-2">
                <input
                  type="checkbox"
                  id="intercept"
                  checked={!!opts.intercept}
                  onChange={(e) => setOpt("intercept", e.target.checked)}
                />
                <Label htmlFor="intercept">{t("analysis.intercept")}</Label>
              </div>
            </>
          )}

          {analysisType === "normality" && (
            <VariableMultiSelect
              label={t("analysis.variables")}
              vars={allVars}
              selected={(opts.variables as string[]) ?? []}
              onToggle={(n) => toggleMulti("variables", n)}
            />
          )}

          {analysisType === "mannwhitney" && (
            <>
              <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent as string} onChange={(v) => setOpt("dependent", v)} />
              <VarSelect label={t("analysis.group")} vars={catVars} value={opts.group as string} onChange={(v) => setOpt("group", v)} />
              <div className="space-y-1">
                <Label>{t("analysis.groupA")}</Label>
                <Input value={(opts.groupA as string) ?? ""} onChange={(e) => setOpt("groupA", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("analysis.groupB")}</Label>
                <Input value={(opts.groupB as string) ?? ""} onChange={(e) => setOpt("groupB", e.target.value)} />
              </div>
            </>
          )}

          {analysisType === "wilcoxon" && (
            <>
              <VarSelect label={t("analysis.pairedA")} vars={allVars} value={opts.pairedA as string} onChange={(v) => setOpt("pairedA", v)} />
              <VarSelect label={t("analysis.pairedB")} vars={allVars} value={opts.pairedB as string} onChange={(v) => setOpt("pairedB", v)} />
            </>
          )}

          {analysisType === "kruskalwallis" && (
            <>
              <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent as string} onChange={(v) => setOpt("dependent", v)} />
              <VarSelect label={t("analysis.group")} vars={catVars} value={opts.group as string} onChange={(v) => setOpt("group", v)} />
            </>
          )}

          {analysisType === "friedman" && (
            <VariableMultiSelect
              label={t("analysis.variables")}
              vars={allVars}
              selected={(opts.variables as string[]) ?? []}
              onToggle={(n) => toggleMulti("variables", n)}
            />
          )}

          {analysisType === "logistic" && (
            <>
              <VarSelect label={t("analysis.dependent")} vars={allVars} value={opts.dependent as string} onChange={(v) => setOpt("dependent", v)} />
              <VariableMultiSelect
                label={t("analysis.independent")}
                vars={allVars}
                selected={(opts.independent as string[]) ?? []}
                onToggle={(n) => toggleMulti("independent", n)}
              />
              <div className="flex items-end gap-2">
                <input
                  type="checkbox"
                  id="logit-intercept"
                  checked={!!opts.intercept}
                  onChange={(e) => setOpt("intercept", e.target.checked)}
                />
                <Label htmlFor="logit-intercept">{t("analysis.intercept")}</Label>
              </div>
            </>
          )}

          {analysisType === "reliability" && (
            <VariableMultiSelect
              label={t("analysis.variables")}
              vars={allVars}
              selected={(opts.variables as string[]) ?? []}
              onToggle={(n) => toggleMulti("variables", n)}
            />
          )}

          {analysisType === "pca" && (
            <>
              <VariableMultiSelect
                label={t("analysis.variables")}
                vars={scaleVars}
                selected={(opts.variables as string[]) ?? []}
                onToggle={(n) => toggleMulti("variables", n)}
              />
              <div className="space-y-1">
                <Label>{t("analysis.components")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={(opts.components as number) ?? 0}
                  onChange={(e) => setOpt("components", e.target.value)}
                  placeholder="auto"
                />
              </div>
              <div className="space-y-1">
                <Label>{t("analysis.rotation")}</Label>
                <Select value={opts.rotation as string} onValueChange={(r) => setOpt("rotation", r)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("analysis.none")}</SelectItem>
                    <SelectItem value="varimax">{t("analysis.varimax")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label>{t("analysis.alpha")}</Label>
            <Input
              type="number"
              step="0.01"
              value={(opts.alpha as number) ?? 0.05}
              onChange={(e) => setOpt("alpha", e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button disabled={busy} onClick={onRun}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Play className="mr-2 h-4 w-4" /> {t("analysis.run")}
          </Button>
          {hasResult && resultId && (
            <Button variant="secondary" onClick={onExportRun}>
              <Download className="mr-2 h-4 w-4" /> {t("analysis.exportRun")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
