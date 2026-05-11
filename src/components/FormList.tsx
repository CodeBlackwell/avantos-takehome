import { useMemo, useState } from "react";
import type {
  BlueprintNode,
  FieldKey,
  FieldSchemaProperty,
  NodeId,
} from "../api/blueprint";
import { getFieldOrder } from "../api/forms";
import { getFormForNode, type Graph } from "../graph/graph";
import type { Mapping, SourceCtx } from "../prefill/types";
import type { SortMode } from "../app/useSortMode";
import type { TreeRow } from "../app/treeOrder";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FormFields } from "./FormFields";

interface Props {
  /** Pre-sorted node list (alpha or topo). Ignored when `sortMode === "tree"`. */
  nodes: BlueprintNode[];
  graph: Graph;
  /** Committed mappings, keyed `[nodeId][fieldKey]`. */
  mappings: Record<NodeId, Record<FieldKey, Mapping>>;
  sortMode: SortMode;
  /** Rendering script for tree mode. Ignored otherwise. */
  treeRows: TreeRow[];
  /** Project a `Mapping` to its inline trigger label (`"Form B.Email"`). */
  describeMapping: (m: Mapping) => string;
  onCommit: (nodeId: NodeId, fieldKey: FieldKey, mapping: Mapping) => void;
  onClear: (nodeId: NodeId, fieldKey: FieldKey) => void;
  className?: string;
}

/** `[fieldKey, fieldSchemaProperty]` pair. */
type FieldEntry = [FieldKey, FieldSchemaProperty];

/**
 * Accordion of every form node in a blueprint, with search + sort modes.
 *
 * In `"tree"` mode the layout is driven by `treeRows` (a precomputed
 * DFS projection); other modes render `nodes` in their incoming order.
 * Search filters by field title and forces every matching form open
 * (search overrides user-driven expansion state until the query clears).
 *
 * Action affordances (`avantos_type === "button"`) are filtered out
 * here, not inside `getFieldOrder` — the source-side picker still needs
 * every field so its disabled-but-visible compatibility rows stay
 * intact (CLAUDE.md rule 7).
 */
export function FormList({
  nodes,
  graph,
  mappings,
  sortMode,
  treeRows,
  describeMapping,
  onCommit,
  onClear,
  className,
}: Props) {
  const [query, setQuery] = useState("");
  const [userExpanded, setUserExpanded] = useState<string[]>([]);

  // Per-node entry: { node, form, fields-after-search-filter }.
  // Recomputed when the inputs change; cheap because the inner loop
  // only walks each form's fields once.
  const filtered = useMemo(() => {
    const queryLower = query.trim().toLowerCase();
    return nodes.flatMap((node) => {
      const form = getFormForNode(graph, node);
      // Strip action affordances from the *target-side* field list.
      // Source-side enumeration in `formFieldsSource` still surfaces
      // them so the picker can show them as disabled rows.
      const allFields: FieldEntry[] = form
        ? getFieldOrder(form).flatMap((key) => {
            const prop = form.field_schema.properties[key];
            if (!prop || prop.avantos_type === "button") return [];
            return [[key, prop] as FieldEntry];
          })
        : [];
      const fields = queryLower
        ? allFields.filter(([key, prop]) =>
            (prop.title ?? key).toLowerCase().includes(queryLower),
          )
        : allFields;
      // Drop nodes with zero matching fields entirely while searching;
      // when not searching, keep them (they render an empty body).
      if (queryLower && fields.length === 0) return [];
      return [{ node, form, fields }];
    });
  }, [nodes, graph, query]);

  // Stable per-node ctx so FieldPicker's `[ctx]` effect doesn't
  // re-fetch source groups on every parent render. Identity changes
  // only when `nodes` or `graph` change.
  const ctxByNode = useMemo(() => {
    const ctxes = new Map<NodeId, SourceCtx>();
    for (const node of nodes) ctxes.set(node.id, { targetNodeId: node.id, graph });
    return ctxes;
  }, [nodes, graph]);

  const isSearching = query.trim().length > 0;
  // While searching, force every matched form open. Otherwise honor
  // the user's manual expansion choices.
  const expanded = isSearching ? filtered.map(({ node }) => node.id) : userExpanded;

  // Tree mode looks up entries by id (the rows array is the order),
  // so a quick map saves an O(N) scan per row.
  const filteredById = useMemo(() => {
    const byId = new Map<NodeId, (typeof filtered)[number]>();
    for (const entry of filtered) byId.set(entry.node.id, entry);
    return byId;
  }, [filtered]);

  // Tree mode is only active outside of search (search forces a flat
  // result set). `treeRows.length === 0` is a defensive fallback for
  // an empty blueprint.
  const useTreeLayout = sortMode === "tree" && !isSearching && treeRows.length > 0;

  /** Render one form's accordion item. Used by both layouts. */
  const renderPrimary = (
    entry: (typeof filtered)[number],
    prefix: string,
    refKey: string,
  ) => {
    const { node, form, fields } = entry;
    // For reusable forms, surface a "shared · N" chip listing the
    // sibling instances. Helps the user understand why edits propagate.
    const sharedNodeIds =
      form?.is_reusable
        ? (graph.nodesByFormId.get(form.id) ?? []).filter((id) => id !== node.id)
        : [];
    const sharedNames = sharedNodeIds
      .map((id) => graph.nodeById.get(id)?.data.name)
      .filter((name): name is string => !!name);
    const workflowChips = workflowMetadata(node);
    return (
      <AccordionItem key={refKey} value={node.id}>
        <AccordionTrigger className="px-3">
          <div className="flex flex-1 flex-col items-start gap-1 text-left">
            <div className="flex items-center gap-2">
              {prefix && (
                <span aria-hidden="true" className="whitespace-pre font-mono text-muted-foreground">
                  {prefix}
                </span>
              )}
              <span className="text-base font-semibold">{node.data.name}</span>
              {sharedNames.length > 0 && (
                <span
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                  title={`This form is also used by: ${sharedNames.join(", ")}`}
                >
                  shared · {sharedNames.length + 1}
                </span>
              )}
              {workflowChips.map((chip) => (
                <span
                  key={chip.label}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                  title={chip.title}
                >
                  {chip.label}
                </span>
              ))}
            </div>
            {form?.description && (
              <span className="text-xs font-normal text-muted-foreground">
                {form.description}
              </span>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          {form ? (
            <FormFields
              form={form}
              formName={node.data.name}
              fields={fields}
              ctx={ctxByNode.get(node.id)!}
              sortMode={sortMode}
              mappings={mappings[node.id] ?? {}}
              describeMapping={describeMapping}
              onCommit={(fieldKey, mapping) => onCommit(node.id, fieldKey, mapping)}
              onClear={(fieldKey) => onClear(node.id, fieldKey)}
            />
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">No fields defined.</p>
          )}
        </AccordionContent>
      </AccordionItem>
    );
  };

  return (
    <Card className={cn("flex flex-col gap-3 p-3", className)}>
      <Input
        type="search"
        placeholder="Search form fields"
        aria-label="Search form fields"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Accordion
        type="multiple"
        className="w-full"
        value={expanded}
        onValueChange={(next) => !isSearching && setUserExpanded(next as string[])}
      >
        {useTreeLayout
          ? treeRows.map((row) => {
              if (row.kind === "ref") {
                // Back-reference: this node's primary appears elsewhere
                // in the tree. Render an italic, non-interactive line
                // with an upward arrow so the user can scroll back to it.
                const refNode = graph.nodeById.get(row.nodeId);
                return (
                  <div
                    key={`ref:${row.nodeId}:${row.prefix}`}
                    className="flex px-3 py-2 text-sm text-muted-foreground"
                    title={`${refNode?.data.name ?? row.nodeId} appears above as a child of another parent`}
                  >
                    <span aria-hidden="true" className="whitespace-pre font-mono">
                      {row.prefix}
                    </span>
                    <span className="italic">{refNode?.data.name ?? row.nodeId}</span>
                    <span aria-hidden="true" className="ml-1">↗</span>
                  </div>
                );
              }
              if (row.kind === "parentRef") {
                // Sibling parent: the current node has another incoming
                // edge from this parent. Visible breadcrumb so every
                // parent edge appears somewhere in the tree.
                const childNode = graph.nodeById.get(row.nodeId);
                const parentNode = graph.nodeById.get(row.parentNodeId);
                return (
                  <div
                    key={`pref:${row.nodeId}:${row.parentNodeId}`}
                    className="flex px-3 py-2 text-sm text-muted-foreground"
                    title={`${childNode?.data.name ?? row.nodeId} also depends on ${parentNode?.data.name ?? row.parentNodeId}`}
                  >
                    <span aria-hidden="true" className="whitespace-pre font-mono">
                      {row.prefix}
                    </span>
                    <span className="italic">{parentNode?.data.name ?? row.parentNodeId}</span>
                    <span aria-hidden="true" className="ml-1">↙</span>
                  </div>
                );
              }
              const entry = filteredById.get(row.nodeId);
              if (!entry) return null;
              return renderPrimary(entry, row.prefix, `primary:${row.nodeId}:${row.prefix}`);
            })
          : filtered.map((entry) => renderPrimary(entry, "", entry.node.id))}
      </Accordion>
    </Card>
  );
}

/**
 * Per-node workflow chips derived from `BlueprintNode.data`.
 *
 * Surfaces SLA, permitted-role count, and approval requirements when
 * the underlying fields are non-empty. Always returns `[]` for the
 * current fixtures (which leave these fields blank), so the title row
 * stays uncluttered on the default view.
 */
function workflowMetadata(node: BlueprintNode): { label: string; title: string }[] {
  const chips: { label: string; title: string }[] = [];
  const sla = node.data.sla_duration;
  if (sla && sla.number > 0) {
    chips.push({
      label: `SLA ${sla.number}${slaUnit(sla.unit)}`,
      title: `SLA ${sla.number} ${sla.unit}`,
    });
  }
  if (node.data.permitted_roles?.length > 0) {
    chips.push({
      label: `${node.data.permitted_roles.length} role${node.data.permitted_roles.length === 1 ? "" : "s"}`,
      title: `Permitted roles: ${node.data.permitted_roles.join(", ")}`,
    });
  }
  if (node.data.approval_required) {
    chips.push({
      label: "approval",
      title:
        node.data.approval_roles?.length > 0
          ? `Approval required: ${node.data.approval_roles.join(", ")}`
          : "Approval required",
    });
  }
  return chips;
}

/** Compact SLA-unit suffix for the chip (`"minutes"` → `"m"`). Falls through to `" <unit>"`. */
const SLA_UNITS: Record<string, string> = {
  minutes: "m",
  hours: "h",
  days: "d",
};

function slaUnit(unit: string): string {
  return SLA_UNITS[unit.toLowerCase()] ?? ` ${unit}`;
}
