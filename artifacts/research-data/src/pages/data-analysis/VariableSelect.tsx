import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VariableMultiSelectProps, VarSelectProps } from "./types";

export function VarSelect({ label, vars, value, onChange }: VarSelectProps) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
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

export function VariableMultiSelect({
  label,
  vars,
  selected,
  onToggle,
}: VariableMultiSelectProps) {
  return (
    <div className="space-y-1 md:col-span-2">
      <Label>{label}</Label>
      <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
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
        {vars.length === 0 && <p className="text-xs text-muted-foreground">No variables.</p>}
      </div>
    </div>
  );
}
