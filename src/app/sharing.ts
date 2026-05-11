/**
 * @file Mapping sharing across reusable form instances.
 *
 * `is_reusable` on a form means multiple nodes (referenced via
 * `BlueprintNode.data.component_id`) can render the same form
 * definition. We share **only** global-source mappings across those
 * instances, because:
 *
 *   - **Graph-source mappings** reference upstream nodes whose ancestor
 *     relationships differ per instance — sharing them would create
 *     unresolvable cross-instance references.
 *   - **Endpoint-source mappings** reference the target form's
 *     `dynamic_field_config`, which is identical across instances
 *     anyway, so sharing has no effect (every instance derives the
 *     same group).
 *
 * Storage stays simple: `(NodeId, FieldKey)` keys throughout. Sharing
 * is enforced at *write* time, not via a synthetic key; siblings just
 * end up holding the same value.
 *
 * Three call sites use this:
 *   - `App.tsx onCommit`       — writes the mapping to every shared sibling.
 *   - `App.tsx onClear`        — clears from every shared sibling.
 *   - `extractSeeds`           — fixture-supplied global seeds on a
 *                                reusable form mirror to every instance up front.
 */

import type { NodeId } from "../api/blueprint";
import type { Graph } from "../graph/graph";
import { getSource } from "../prefill/registry";
import type { Mapping } from "../prefill/types";

/**
 * Return every node id that should mirror writes/clears for `mapping`.
 *
 * Defaults to `[nodeId]` (no fan-out). Returns the full sibling set
 * only when:
 *   - the mapping's source is global, AND
 *   - the target node renders a reusable form.
 *
 * The returned list always includes `nodeId` itself.
 */
export function nodesSharing(graph: Graph, nodeId: NodeId, mapping: Mapping): NodeId[] {
  const source = getSource(mapping.sourceId);
  if (source?.kind !== "global") return [nodeId];
  const node = graph.nodeById.get(nodeId);
  if (!node) return [nodeId];
  const form = graph.formById.get(node.data.component_id);
  if (!form?.is_reusable) return [nodeId];
  return graph.nodesByFormId.get(form.id) ?? [nodeId];
}
