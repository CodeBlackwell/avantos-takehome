import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Where a blueprint payload originated.
 *
 * - `"server"` — backed by the live mock server (one fixture today).
 * - `"local"`  — backed by `src/api/blueprints/*.json` (frontend-only).
 *
 * Drives the per-row dot color and the legend at the bottom of the card.
 */
export type BlueprintSource = "server" | "local";

/** One row in the blueprint selector. */
export interface BlueprintOption {
  /** Stable id used by `fetchBlueprint`. */
  id: string;
  /** Button label (the payload's `name` field). */
  label: string;
  /** Origin tag — drives dot color and tooltip. */
  source: BlueprintSource;
  /** Optional payload `description`, surfaced in the button title. */
  description?: string;
  /** Optional payload `category`, surfaced in the button title. */
  category?: string;
}

/** Tailwind class for each source's color dot. */
const SOURCE_DOT: Record<BlueprintSource, string> = {
  server: "bg-emerald-500",
  local: "bg-amber-500",
};

/** Tooltip prefix per source — appended with category/description if present. */
const SOURCE_TITLE: Record<BlueprintSource, string> = {
  server: "Loaded from the mock server",
  local: "Loaded from the frontend (no server endpoint)",
};

interface Props {
  options: BlueprintOption[];
  /** Currently selected blueprint id. */
  value: string;
  /** Fired when the user clicks a blueprint button. */
  onChange: (id: string) => void;
}

/**
 * Button bar for picking a blueprint.
 *
 * Each option renders as a Button with a colored dot indicating its
 * source (server vs. local frontend fixture). Selection is signalled
 * via Button's `default` variant + `aria-pressed`. A small Legend
 * below decodes the dot colors.
 */
export function BlueprintSelector({ options, value, onChange }: Props) {
  return (
    <Card className="flex flex-col gap-2 p-2">
      <div className="flex flex-row flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = option.id === value;
          // Tooltip parts are filtered so we don't render trailing
          // separators when description/category are absent.
          const tooltipParts = [
            SOURCE_TITLE[option.source],
            option.category,
            option.description,
          ].filter(Boolean);
          return (
            <Button
              key={option.id}
              variant={isSelected ? "default" : "outline"}
              size="sm"
              aria-pressed={isSelected}
              title={tooltipParts.join(" — ")}
              onClick={() => onChange(option.id)}
              className="gap-2"
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 rounded-full ${SOURCE_DOT[option.source]}`}
              />
              {option.label}
            </Button>
          );
        })}
      </div>
      <Legend />
    </Card>
  );
}

/** Decoder ring for the per-row source dots. */
function Legend() {
  return (
    <div className="flex flex-row gap-4 px-1 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${SOURCE_DOT.server}`} />
        from server
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${SOURCE_DOT.local}`} />
        from frontend
      </span>
    </div>
  );
}
