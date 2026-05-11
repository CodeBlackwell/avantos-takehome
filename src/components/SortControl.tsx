import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortMode } from "../app/useSortMode";

interface Props {
  /** Current sort mode. */
  value: SortMode;
  /** Fired when the user picks a different mode. */
  onChange: (mode: SortMode) => void;
}

/**
 * Dropdown that toggles the form list between alphabetical, dependency-order
 * (topological), and tree views.
 *
 * Stateless — the parent owns the mode (typically via `useSortMode`).
 * The `onValueChange` cast is safe because the `<SelectItem>` values
 * below are exhaustive over `SortMode`.
 */
export function SortControl({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="sort-mode" className="text-xs uppercase tracking-wide text-muted-foreground">
        Sort
      </Label>
      <Select value={value} onValueChange={(next) => onChange(next as SortMode)}>
        <SelectTrigger id="sort-mode" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="alpha">Alphabetical</SelectItem>
          <SelectItem value="topo">Dependency order</SelectItem>
          <SelectItem value="tree">Tree</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
