import { Boxes } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisVariable } from "./types";

interface VariablePaletteProps {
  variables: AnalysisVariable[];
  onAssign: (name: string) => void;
}

function measureBadge(measure: string, t: (k: string) => string) {
  if (measure === "scale") {
    return <Badge variant="secondary" className="text-[10px]">{t("analysis.scale")}</Badge>;
  }
  if (measure === "ordinal") {
    return <Badge variant="outline" className="text-[10px]">{t("analysis.ordinal")}</Badge>;
  }
  return <Badge variant="outline" className="text-[10px]">{t("analysis.nominal")}</Badge>;
}

export function VariablePalette({ variables, onAssign }: VariablePaletteProps) {
  const { t } = useTranslation();
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" /> {t("analysis.variableView")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-2">
          Click a variable to assign it to the active analysis.
        </p>
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {variables.map((v) => (
            <button
              key={v.name}
              onClick={() => onAssign(v.name)}
              className="w-full text-left rounded-md border px-2 py-1.5 hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{v.label || v.name}</span>
                {measureBadge(v.measure, t)}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">{v.name}</div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
