import type { Graph } from "../graph/graph";
import { getSource } from "../prefill/registry";
import type { Mapping } from "../prefill/types";

/**
 * Per-mapping summary consumed by `GraphView`'s tile + tooltip.
 *
 * Lives in `app/` (not `components/GraphView`) so the data layer
 * doesn't import from the view layer — keeps the dependency graph
 * acyclic and lets tests over `buildDepsByNode` skip React entirely.
 */
export interface NodeDep {
  /** Field key on the target node. */
  fieldLabel: string;
  /** Display name of the source form (or global namespace). */
  sourceLabel: string;
  /** Human title of the target field (falls back to the key). */
  fieldTitle: string;
  /** Same as `sourceLabel` — kept distinct for tooltip vs. tile copy. */
  sourceFormName: string;
  /** Title of the source field (option) inside `sourceFormName`. */
  sourceFieldTitle: string;
}

/**
 * Project the mappings store into a per-node dependency list keyed by
 * `nodeId`.
 *
 * Nodes with no mappings are omitted (so `GraphView` doesn't render an
 * empty divider). Mappings whose source is no longer registered are
 * skipped defensively — `pruneDeadMappings` should have already
 * cleaned them, but we don't want a stale entry to crash the view.
 *
 * @returns A `Map<NodeId, NodeDep[]>`. Empty when `graph` is `null`.
 */
export function buildDepsByNode(
  graph: Graph | null,
  mappings: Record<string, Record<string, Mapping>>,
): Map<string, NodeDep[]> {
  const depsByNode = new Map<string, NodeDep[]>();
  if (!graph) return depsByNode;
  for (const node of graph.nodes) {
    const fieldMap = mappings[node.id] ?? {};
    if (Object.keys(fieldMap).length === 0) continue;
    const targetForm = graph.formById.get(node.data.component_id);
    const deps: NodeDep[] = [];
    for (const [fieldKey, mapping] of Object.entries(fieldMap)) {
      const fieldTitle = targetForm?.field_schema.properties[fieldKey]?.title ?? fieldKey;
      const source = getSource(mapping.sourceId);
      if (!source) continue;
      const { sourceFormName, sourceFieldTitle } = source.describe(mapping, graph);
      deps.push({
        fieldLabel: fieldKey,
        sourceLabel: sourceFormName,
        fieldTitle,
        sourceFormName,
        sourceFieldTitle,
      });
    }
    depsByNode.set(node.id, deps);
  }
  return depsByNode;
}
