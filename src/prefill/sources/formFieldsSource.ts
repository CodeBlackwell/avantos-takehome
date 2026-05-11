import type { BlueprintNode } from "../../api/blueprint";
import { getFieldOrder } from "../../api/forms";
import { getAncestors, getFormForNode, type Graph } from "../../graph/graph";
import { matchSource } from "../match";
import type { Mapping, MappingDescription, PrefillSource, SourceCtx, SourceGroup } from "../types";

/**
 * Build a graph-source that surfaces upstream form fields as picker
 * options.
 *
 * - `"direct"`     — parents directly upstream of the target (one hop).
 * - `"transitive"` — all upstream ancestors EXCLUDING direct parents.
 *
 * The two modes are registered as separate sources so the picker shows
 * two disjoint sections (matches the PDF screenshot in the assignment).
 *
 * Mapping shape: `groupId` is the upstream `NodeId`, `optionId` is the
 * `FieldKey` on that node's form.
 *
 * @param mode Selects which slice of the ancestor set to surface.
 */
export function formFieldsSource(mode: "direct" | "transitive"): PrefillSource {
  // Stable id per mode — persisted inside `Mapping.sourceId`. Renaming
  // either id is a breaking change for any user with persisted data.
  const id = `form-fields-${mode}`;
  return {
    id,
    label: mode === "direct" ? "Direct dependencies" : "Transitive dependencies",
    kind: "graph",

    getGroups(ctx: SourceCtx): SourceGroup[] {
      return ancestorsFor(ctx, mode).map((node) => nodeToGroup(ctx, node));
    },

    /**
     * Resolve to the upstream submission's value for the named field.
     * `submissions` is currently only populated by tests — in the live
     * app this returns `undefined` (the picker is wiring-only; no
     * runtime fill yet).
     */
    resolve(mapping: Mapping, ctx: SourceCtx): unknown {
      return ctx.submissions?.[mapping.groupId]?.[mapping.optionId];
    },

    describe(mapping: Mapping, graph: Graph): MappingDescription {
      const sourceNode = graph.nodeById.get(mapping.groupId);
      const sourceForm = sourceNode ? graph.formById.get(sourceNode.data.component_id) : undefined;
      const fieldTitle = sourceForm?.field_schema.properties[mapping.optionId]?.title ?? mapping.optionId;
      const formName = sourceNode?.data.name ?? mapping.groupId;
      return {
        triggerLabel: `${formName}.${fieldTitle}`,
        sourceFormName: formName,
        sourceFieldTitle: fieldTitle,
      };
    },

    validateMapping: (raw) => matchSource(raw, id),

    /**
     * The mapping survives iff the referenced ancestor is still in the
     * correct ancestor slice for this mode AND the referenced field
     * still exists on its form. Re-derives the slice each time because
     * ancestor sets are per-target — different target nodes have
     * different ancestors.
     */
    isResolvableIn(mapping: Mapping, ctx: SourceCtx): boolean {
      const validAncestors = ancestorsFor(ctx, mode);
      const ancestor = validAncestors.find((node) => node.id === mapping.groupId);
      if (!ancestor) return false;
      const form = getFormForNode(ctx.graph, ancestor);
      return !!form && Object.prototype.hasOwnProperty.call(form.field_schema.properties, mapping.optionId);
    },
  };
}

/**
 * Slice the ancestor set to match the source mode.
 *
 * Both modes go through `getAncestors` to avoid duplicating BFS logic;
 * `"transitive"` filters out direct parents so the two registered
 * sources surface disjoint groups in the picker.
 */
function ancestorsFor(ctx: SourceCtx, mode: "direct" | "transitive"): BlueprintNode[] {
  const directParents = getAncestors(ctx.graph, ctx.targetNodeId, { transitive: false });
  if (mode === "direct") return directParents;
  const directParentIds = new Set(directParents.map((node) => node.id));
  return getAncestors(ctx.graph, ctx.targetNodeId, { transitive: true }).filter(
    (node) => !directParentIds.has(node.id),
  );
}

/**
 * Project an upstream node into a picker `SourceGroup`. Each form
 * field becomes one option, tagged with its `avantos_type` so the
 * compat check has what it needs.
 */
function nodeToGroup(ctx: SourceCtx, node: BlueprintNode): SourceGroup {
  const form = getFormForNode(ctx.graph, node);
  if (!form) return { id: node.id, label: node.data.name, options: [] };
  return {
    id: node.id,
    label: node.data.name,
    options: getFieldOrder(form).flatMap((fieldKey) => {
      const prop = form.field_schema.properties[fieldKey];
      if (!prop) return [];
      return [
        {
          id: fieldKey,
          label: prop.title ?? fieldKey,
          type: prop.avantos_type,
          format: prop.format,
        },
      ];
    }),
  };
}
