import { useEffect, useMemo, useState } from "react";
import type { AvantosType } from "../api/blueprint";
import { isCompatible } from "../prefill/compat";
import { sources } from "../prefill/registry";
import type { SortMode } from "../app/useSortMode";
import type { Mapping, PrefillSource, SourceCtx, SourceGroup, SourceOption } from "../prefill/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * Callers MUST keep `ctx` referentially stable per target field.
   *
   * The effect below depends on `ctx`, so a fresh object every parent
   * render would re-fetch every source's `getGroups` on every keystroke
   * (search input lives one component up). `FormList` memoises one
   * ctx per node id to satisfy this contract.
   */
  ctx: SourceCtx;
  sortMode: SortMode;
  /** Display label of the target field (used in the staged-selection caption). */
  fieldLabel: string;
  /** Display name of the target node (used in the staged-selection caption). */
  formName: string;
  /** `avantos_type` of the target field — drives compat checks. */
  targetType: AvantosType;
  /** Optional sub-format hint (rendered in the target's TypeBadge). */
  targetFormat?: string;
  /** Currently committed mapping, or `undefined` if the field is unset. */
  current: Mapping | undefined;
  /** Fired when the user clicks Select on a valid pending mapping. */
  onCommit: (mapping: Mapping) => void;
  /** Fired when the user clicks Cancel — picker collapses, no write. */
  onCancel: () => void;
  /** Fired when the user clicks Clear (only shown if `current` is set). */
  onClear: () => void;
}

/** A source paired with its loaded groups. */
interface ResolvedSource {
  source: PrefillSource;
  groups: SourceGroup[];
}

/** Flat picker row — one rendered Accordion section per `(source, group)`. */
interface FlatRow {
  source: PrefillSource;
  group: SourceGroup;
}

/**
 * Inline picker that lets the user choose a prefill mapping for one field.
 *
 * Loads every registered source's groups in parallel on `ctx` change,
 * sorts them per `sortMode`, and renders one accordion section per
 * `(source, group)`. Type-incompatible options stay visible but
 * disabled (per CLAUDE.md rule 7) — the user can see *why* a row is
 * blocked. The pending selection is staged locally; nothing is
 * persisted until `onCommit`.
 *
 * Remount semantics: when the parent's `current` changes externally
 * (e.g. another sibling instance committed a global mapping), the
 * parent re-keys this component so it remounts with the new initial
 * `pending`. That keeps the picker's pending state in sync without a
 * derived-state effect.
 */
export function FieldPicker({
  ctx,
  sortMode,
  fieldLabel,
  formName,
  targetType,
  targetFormat,
  current,
  onCommit,
  onCancel,
  onClear,
}: Props) {
  const [resolved, setResolved] = useState<ResolvedSource[] | null>(null);
  // Initial value captures `current` at mount. Parent re-keys this
  // component when the saved mapping changes (see FormList), so a
  // fresh `current` arrives via remount — no derived-state effect.
  const [pending, setPending] = useState<Mapping | null>(current ?? null);

  // Fetch every source's groups on mount / ctx change. The `cancelled`
  // flag prevents stale fetches from racing into state after a remount.
  useEffect(() => {
    let cancelled = false;
    Promise.all(sources.map(async (source) => ({ source, groups: await source.getGroups(ctx) })))
      .then((next) => !cancelled && setResolved(next))
      .catch(() => !cancelled && setResolved([]));
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const sorted = useMemo(() => sortGroups(resolved ?? [], ctx, sortMode), [resolved, ctx, sortMode]);
  const flatRows = useMemo(() => flatten(sorted), [sorted]);

  const canCommit = pending !== null && !isSameMapping(pending, current);
  const isPending = (sourceId: string, groupId: string, optionId: string) =>
    pending?.sourceId === sourceId && pending?.groupId === groupId && pending?.optionId === optionId;

  // Labels for the bottom-bar staged caption (`Pre-fills X with Y from Z`).
  // Computed only when there's actually a stage-able pending choice.
  const stagedLabels = canCommit && pending ? findLabels(resolved, pending) : null;

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          Target: <strong className="font-medium text-foreground">{fieldLabel}</strong>
        </span>
        <TypeBadge type={targetType} format={targetFormat} />
      </div>

      <div className="rounded-md border bg-background px-2">
        {resolved === null ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : flatRows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No options.</p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {flatRows.map(({ source, group }) => (
              <AccordionItem
                key={`${source.id}:${group.id}`}
                value={`${source.id}:${group.id}`}
              >
                <AccordionTrigger className="px-2">{group.label}</AccordionTrigger>
                <AccordionContent>
                  <ul className="flex flex-col">
                    {group.options.map((option) => {
                      const isOptionCompatible = isCompatible(targetType, option.type);
                      const isStaged = isPending(source.id, group.id, option.id);
                      return (
                        <li key={option.id}>
                          <Button
                            variant={isStaged ? "secondary" : "ghost"}
                            size="sm"
                            disabled={!isOptionCompatible}
                            aria-pressed={isStaged}
                            title={
                              isOptionCompatible
                                ? undefined
                                : `Type "${option.type}" cannot prefill a "${targetType}" field`
                            }
                            className={cn(
                              "w-full justify-start gap-2 pl-6 font-normal",
                              !isOptionCompatible && "opacity-60",
                            )}
                            onClick={() =>
                              isOptionCompatible &&
                              setPending({ sourceId: source.id, groupId: group.id, optionId: option.id })
                            }
                          >
                            <span className="flex-1 truncate text-left">{option.label}</span>
                            <TypeBadge type={option.type} format={option.format} muted={!isOptionCompatible} />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <div className="flex items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">
          {stagedLabels ? (
            <>
              Pre-fills <strong className="font-medium text-foreground">{fieldLabel}</strong>{" "}
              in <strong className="font-medium text-foreground">{formName}</strong>{" "}
              with <strong className="font-medium text-foreground">{stagedLabels.option}</strong>{" "}
              from <strong className="font-medium text-foreground">{stagedLabels.group}</strong>
            </>
          ) : null}
        </p>
        {current && (
          <Button variant="outline" onClick={onClear}>
            Clear
          </Button>
        )}
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!canCommit} onClick={() => pending && onCommit(pending)}>
          Select
        </Button>
      </div>
    </div>
  );
}

/** Per-`AvantosType` color palette for the TypeBadge chip. */
const TYPE_COLORS: Record<AvantosType, string> = {
  "short-text": "bg-slate-100 text-slate-700",
  "multi-line-text": "bg-violet-100 text-violet-700",
  "object-enum": "bg-sky-100 text-sky-700",
  "multi-select": "bg-teal-100 text-teal-700",
  "checkbox-group": "bg-emerald-100 text-emerald-700",
  button: "bg-amber-100 text-amber-700",
};

/** Tiny color-coded chip showing an `avantos_type` (and optional format hint). */
function TypeBadge({
  type,
  format,
  muted = false,
}: {
  type: AvantosType;
  format?: string;
  muted?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        TYPE_COLORS[type],
        muted && "opacity-50",
      )}
    >
      {type}
      {format && <span className="opacity-70"> · {format}</span>}
    </span>
  );
}

/** Structural equality across all three discriminator fields. */
function isSameMapping(a: Mapping, b: Mapping | undefined): boolean {
  return !!b && a.sourceId === b.sourceId && a.groupId === b.groupId && a.optionId === b.optionId;
}

/**
 * Resolve a `Mapping` back to its display labels using the loaded
 * groups. Used only for the bottom-bar staged caption.
 *
 * Returns `null` if either the group or option is no longer present
 * (defensive — should not happen for a freshly staged pending mapping).
 */
function findLabels(
  resolved: ResolvedSource[] | null,
  mapping: Mapping,
): { group: string; option: string } | null {
  const group = resolved
    ?.find((entry) => entry.source.id === mapping.sourceId)
    ?.groups.find((g) => g.id === mapping.groupId);
  const option = group?.options.find((o: SourceOption) => o.id === mapping.optionId);
  if (!group || !option) return null;
  return { group: group.label, option: option.label };
}

/**
 * Sort each source's groups according to `mode`.
 *
 * - `"alpha"` sorts every source by group label.
 * - Otherwise, only graph-source groups are sorted (by `topoIndex`);
 *   global and endpoint sources keep registry order, which already
 *   reflects the underlying JSON file order and is meaningful enough.
 */
function sortGroups(
  resolved: ResolvedSource[],
  ctx: SourceCtx,
  mode: SortMode,
): ResolvedSource[] {
  return resolved.map(({ source, groups }) => {
    const next = groups.slice();
    if (mode === "alpha") {
      next.sort((a, b) => a.label.localeCompare(b.label));
    } else if (source.kind === "graph") {
      next.sort(
        (a, b) =>
          (ctx.graph.topoIndex.get(a.id) ?? 0) - (ctx.graph.topoIndex.get(b.id) ?? 0),
      );
    }
    return { source, groups: next };
  });
}

/**
 * Flatten resolved sources into one row per `(source, group)` pair,
 * ordered globals → endpoints → graph.
 *
 * Endpoints sit between globals (which are blueprint-independent) and
 * graph parents (the dominant prefill axis) because they describe the
 * target form itself — closer to "global" than to "ancestor."
 */
function flatten(resolved: ResolvedSource[]): FlatRow[] {
  const globals: FlatRow[] = [];
  const endpoints: FlatRow[] = [];
  const forms: FlatRow[] = [];
  for (const { source, groups } of resolved) {
    const bucket =
      source.kind === "graph" ? forms : source.kind === "endpoint" ? endpoints : globals;
    for (const group of groups) bucket.push({ source, group });
  }
  return [...globals, ...endpoints, ...forms];
}
