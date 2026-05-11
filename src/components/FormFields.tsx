import { useState } from "react";
import type { BlueprintForm, FieldKey, FieldSchemaProperty } from "../api/blueprint";
import { isRequired } from "../api/forms";
import { getSource } from "../prefill/registry";
import type { Mapping, SourceCtx } from "../prefill/types";
import type { SortMode } from "../app/useSortMode";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { FieldPicker } from "./FieldPicker";

/** `[fieldKey, fieldSchemaProperty]` pair — pre-filtered by `FormList`. */
type FieldEntry = [FieldKey, FieldSchemaProperty];

interface Props {
  form: BlueprintForm;
  /** Display name of the *node* (not the form) — used for picker copy. */
  formName: string;
  /** Pre-filtered field list (action-affordances stripped). */
  fields: FieldEntry[];
  /** Stable per-node SourceCtx — see `FormList.ctxByNode`. */
  ctx: SourceCtx;
  sortMode: SortMode;
  /** Mappings already committed for this node. Keyed by `FieldKey`. */
  mappings: Record<FieldKey, Mapping>;
  /** Project a `Mapping` to its inline trigger label (`"Form B.Email"`). */
  describeMapping: (m: Mapping) => string;
  onCommit: (fieldKey: FieldKey, mapping: Mapping) => void;
  onClear: (fieldKey: FieldKey) => void;
}

/**
 * One accordion row per field. Expanding a row reveals the
 * `FieldPicker` inline.
 *
 * Single-mode accordion: only one field's picker is open at a time
 * (avoids long stacked pickers and keeps focus management trivial).
 * Committing or cancelling collapses the row from the picker's
 * callbacks.
 */
export function FormFields({
  form,
  formName,
  fields,
  ctx,
  sortMode,
  mappings,
  describeMapping,
  onCommit,
  onClear,
}: Props) {
  const [openField, setOpenField] = useState<string>("");

  return (
    <Accordion
      type="single"
      collapsible
      value={openField}
      onValueChange={setOpenField}
      className="w-full px-1"
    >
      {fields.map(([fieldKey, prop]) => {
        const currentMapping = mappings[fieldKey];
        const required = isRequired(form, fieldKey);
        const fieldLabel = prop.title ?? fieldKey;
        const triggerLabel = currentMapping
          ? `${fieldLabel}: ${describeMapping(currentMapping)}`
          : fieldLabel;
        // Re-key the picker on the saved mapping so React remounts it
        // when `current` changes externally (e.g. another instance of
        // a reusable form committed a global mapping). This replaces a
        // derived-state `useEffect` inside the picker.
        const pickerKey = currentMapping
          ? `${currentMapping.sourceId}:${currentMapping.groupId}:${currentMapping.optionId}`
          : "unset";
        // On reusable forms, mark whether the mapping fans out to
        // siblings (global source) or stays on this instance only
        // (graph/endpoint).
        const scope = form.is_reusable && currentMapping
          ? getSource(currentMapping.sourceId)?.kind === "global" ? "shared" : "local"
          : null;
        return (
          <AccordionItem
            key={fieldKey}
            value={fieldKey}
            // Hide both chevron variants when a mapping is set — the
            // X button replaces it as the row's right-edge affordance.
            // `data-[slot=accordion-trigger-icon]` matches the chevron
            // pair rendered by `ui/accordion.tsx`.
            className={cn(
              "relative",
              currentMapping && "[&_[data-slot=accordion-trigger-icon]]:hidden",
            )}
          >
            <AccordionTrigger
              className={cn(
                "px-2 text-sm font-normal",
                currentMapping && "pr-9",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <span>{triggerLabel}</span>
                {required && (
                  <span
                    aria-hidden="true"
                    className="text-destructive"
                    title="Required field"
                  >
                    *
                  </span>
                )}
                {scope && (
                  <span
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                    title={
                      scope === "shared"
                        ? "Mirrors to every instance of this reusable form"
                        : "Applies to this instance only"
                    }
                  >
                    {scope}
                  </span>
                )}
              </span>
            </AccordionTrigger>
            {currentMapping && (
              // Sibling of AccordionTrigger (not nested — nested
              // <button>s are invalid HTML). Absolute-positioned to
              // sit at the row's right edge, just inside the chevron;
              // the trigger gets `pr-12` to clear space for it.
              <button
                type="button"
                aria-label={`Clear prefill mapping for ${fieldLabel}`}
                title="Clear prefill mapping"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear(fieldKey);
                  if (openField === fieldKey) setOpenField("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[11px] leading-none text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
            <AccordionContent>
              <FieldPicker
                key={pickerKey}
                ctx={ctx}
                sortMode={sortMode}
                fieldLabel={fieldLabel}
                formName={formName}
                targetType={prop.avantos_type}
                targetFormat={prop.format}
                current={currentMapping}
                onCommit={(mapping) => {
                  onCommit(fieldKey, mapping);
                  setOpenField("");
                }}
                onCancel={() => setOpenField("")}
                onClear={() => {
                  onClear(fieldKey);
                  setOpenField("");
                }}
              />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
