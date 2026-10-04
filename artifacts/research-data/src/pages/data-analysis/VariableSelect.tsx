import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VariableMultiSelectProps, VarSelectProps } from "./types";

/**
 * Single-variable picker.
 *
 * The `<Label>` had no `htmlFor` and the `SelectTrigger` had no `id`, so the
 * trigger was announced as a bare "button" with no name. shadcn's `Select`
 * forwards `id` onto the trigger, so pairing the two is enough.
 */
export function VarSelect({ label, vars, value, onChange }: VarSelectProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {vars.map((v) => (
            <SelectItem key={v.name} value={v.name}>
              {v.label || v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Multi-variable picker.
 *
 * A set of checkboxes has no single control to point a `<label htmlFor>` at, so
 * the group label became the accessible name of a `role="group"` via
 * `aria-labelledby`. Each checkbox is still wrapped in its own `<label>`, so it
 * keeps its own name from the visible variable text.
 */
export function VariableMultiSelect({
  label,
  vars,
  selected,
  onToggle,
}: VariableMultiSelectProps) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="space-y-1 md:col-span-2">
      <span id={id} className="text-sm font-medium leading-none text-muted-foreground">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={id}
        className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1"
      >
        {vars.map((v) => (
          <label key={v.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(v.name)}
              onChange={() => onToggle(v.name)}
            />
            {v.label || v.name}
          </label>
        ))}
        {vars.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("analysis.noVariables")}</p>
        )}
      </div>
    </div>
  );
}
