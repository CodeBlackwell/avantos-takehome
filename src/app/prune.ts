import type { Graph } from "../graph/graph";
import { getSource } from "../prefill/registry";
import type { Mapping, SourceCtx } from "../prefill/types";
import type { MappingsState } from "../prefill/useMappings";

/**
 * Drop persisted mappings that no longer make sense in `graph`.
 *
 * Conditions for removal (any one is sufficient):
 *   - target node not in this blueprint,
 *   - target field removed from the target node's form,
 *   - source removed from the registry (defensive — `loadState` also checks),
 *   - source can no longer resolve the mapping (parent disappeared,
 *     ancestor relationship broken, global key removed, …).
 *
 * Returns a fresh `MappingsState`; never mutates the input. Nodes left
 * with no surviving fields are omitted entirely (saves a render pass
 * over empty entries).
 *
 * Called by `App` on every blueprint load via `useMappings.pruneMappings`,
 * before `seedMappings`, so stale entries from a prior blueprint don't
 * shadow the new fixture's seeds.
 */
export function pruneDeadMappings(graph: Graph, mappings: MappingsState): MappingsState {
  const pruned: MappingsState = {};
  for (const [nodeId, fields] of Object.entries(mappings)) {
    const targetNode = graph.nodeById.get(nodeId);
    if (!targetNode) continue;
    const targetForm = graph.formById.get(targetNode.data.component_id);
    if (!targetForm) continue;
    const ctx: SourceCtx = { targetNodeId: nodeId, graph };
    const survivingFields: Record<string, Mapping> = {};
    for (const [fieldKey, mapping] of Object.entries(fields)) {
      // Field removed from this form definition.
      if (!Object.prototype.hasOwnProperty.call(targetForm.field_schema.properties, fieldKey)) continue;
      // Source deregistered — defensive; `loadState` filters these too.
      const source = getSource(mapping.sourceId);
      if (!source) continue;
      // Source-specific resolvability check (parent gone, global removed, …).
      if (!source.isResolvableIn(mapping, ctx)) continue;
      survivingFields[fieldKey] = mapping;
    }
    if (Object.keys(survivingFields).length > 0) pruned[nodeId] = survivingFields;
  }
  return pruned;
}
