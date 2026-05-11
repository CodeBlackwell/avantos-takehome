import type {
  BlueprintEdge,
  BlueprintForm,
  BlueprintNode,
  BlueprintResponse,
  FormId,
  NodeId,
} from "../api/blueprint";

/**
 * Indexed projection of a `BlueprintResponse` for cheap lookups.
 *
 * Built once per blueprint by {@link buildGraph}. Every consumer (picker,
 * prune, traversal, sort, sharing) reads from this struct rather than
 * walking the wire payload — an O(1) lookup for "what's this node's form?"
 * keeps the hot paths flat.
 */
export interface Graph {
  /** Original wire-order node list (forms on the canvas). */
  nodes: BlueprintNode[];
  /** Original wire-order edge list (parent → child). */
  edges: BlueprintEdge[];
  /** Node lookup by `NodeId`. O(1) replacement for `nodes.find(...)`. */
  nodeById: Map<NodeId, BlueprintNode>;
  /** Form definition lookup by `FormId`. */
  formById: Map<FormId, BlueprintForm>;
  /**
   * For each node, the ids of its direct parents (one entry per incoming
   * edge). Built from `edges[]` only — `node.data.prerequisites` is a
   * denormalization we deliberately ignore (see CLAUDE.md hard rule 8).
   */
  parentsByNodeId: Map<NodeId, NodeId[]>;
  /**
   * Reverse index: which canvas nodes render each form definition.
   *
   * Multiple entries means the form is reused across the blueprint
   * (`form.is_reusable === true`); `nodesSharing` uses this to fan global
   * mappings out to every instance.
   */
  nodesByFormId: Map<FormId, NodeId[]>;
  /**
   * Zero-based topological rank: parents come before children, with an
   * alphabetical tiebreak between independent nodes so the order is
   * deterministic across reloads.
   */
  topoIndex: Map<NodeId, number>;
}

/**
 * Build a {@link Graph} index from a fresh blueprint response.
 *
 * `edges[]` is the canonical parent source — `node.data.prerequisites` is a
 * denormalization that may drift, so we ignore it here (CLAUDE.md hard
 * rule 8). All Maps are constructed eagerly because every downstream
 * consumer reads them on the hot path.
 *
 * @param response Wire payload from {@link import("../api/blueprint").fetchBlueprint}.
 * @returns A self-contained, immutable index over `response`.
 */
export function buildGraph(response: BlueprintResponse): Graph {
  const nodeById = new Map(response.nodes.map((node) => [node.id, node]));
  const formById = new Map(response.forms.map((form) => [form.id, form]));

  // Seed every node with an empty parent list, then push one entry per edge.
  // Two-pass keeps the loop body trivial and avoids `??=` in the inner loop.
  const parentsByNodeId = new Map<NodeId, NodeId[]>();
  for (const node of response.nodes) parentsByNodeId.set(node.id, []);
  for (const edge of response.edges) {
    const parents = parentsByNodeId.get(edge.target);
    if (parents) parents.push(edge.source);
  }

  // Reverse index keyed on the form definition id (component_id). Reusable
  // forms produce multi-entry lists; everything else stays single-entry.
  const nodesByFormId = new Map<FormId, NodeId[]>();
  for (const node of response.nodes) {
    const siblings = nodesByFormId.get(node.data.component_id);
    if (siblings) siblings.push(node.id);
    else nodesByFormId.set(node.data.component_id, [node.id]);
  }

  return {
    nodes: response.nodes,
    edges: response.edges,
    nodeById,
    formById,
    parentsByNodeId,
    nodesByFormId,
    topoIndex: computeTopoIndex(response.nodes, parentsByNodeId),
  };
}

/**
 * Kahn's algorithm with an alphabetical tiebreak.
 *
 * Maintains a `ready` queue of nodes whose remaining in-degree is zero;
 * each pop assigns the next ordinal and decrements its children. Inserting
 * newly-ready nodes in name order keeps the layout stable across reloads
 * (without it, two children of the same parent would sort by hash-table
 * iteration order, which differs run-to-run).
 *
 * Cycles cannot occur in well-formed blueprints; if one slips through we
 * still complete by appending leftovers in declaration order.
 */
function computeTopoIndex(
  nodes: BlueprintNode[],
  parentsByNodeId: Map<NodeId, NodeId[]>,
): Map<NodeId, number> {
  const remainingInDegree = new Map<NodeId, number>(
    nodes.map((node) => [node.id, parentsByNodeId.get(node.id)?.length ?? 0]),
  );
  // Outgoing-edge index, derived from the parent index. Allocated once so
  // the inner loop is O(children) per pop instead of O(edges) per pop.
  const childrenOf = new Map<NodeId, NodeId[]>(nodes.map((node) => [node.id, []]));
  for (const node of nodes) {
    for (const parentId of parentsByNodeId.get(node.id) ?? []) {
      childrenOf.get(parentId)?.push(node.id);
    }
  }

  const nameOf = (id: NodeId) => nodes.find((node) => node.id === id)?.data.name ?? id;

  // Roots first, sorted by name. From here on, ordering is preserved by
  // inserting newly-ready nodes at their alphabetic insertion point.
  const ready = nodes.filter((node) => (remainingInDegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  ready.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const topoIndex = new Map<NodeId, number>();
  while (ready.length > 0) {
    const nextId = ready.shift()!;
    topoIndex.set(nextId, topoIndex.size);
    for (const childId of childrenOf.get(nextId) ?? []) {
      const remaining = (remainingInDegree.get(childId) ?? 0) - 1;
      remainingInDegree.set(childId, remaining);
      if (remaining === 0) {
        const insertAt = ready.findIndex((readyId) => nameOf(readyId).localeCompare(nameOf(childId)) > 0);
        if (insertAt === -1) ready.push(childId);
        else ready.splice(insertAt, 0, childId);
      }
    }
  }
  // Defensive: cycles shouldn't occur in valid blueprints, but if any node
  // never reached zero in-degree we still want a total order to fall back on.
  for (const node of nodes) if (!topoIndex.has(node.id)) topoIndex.set(node.id, topoIndex.size);
  return topoIndex;
}

/**
 * Walk up the parent edges from `nodeId`.
 *
 * - `transitive: false` → direct parents only (one hop).
 * - `transitive: true`  → every ancestor reachable along parent edges.
 *
 * Order is BFS (closest parents first); diamond ancestry is de-duped so
 * each ancestor appears at most once.
 *
 * @returns The ancestor nodes themselves (not just ids); callers usually
 *          need the form metadata too.
 */
export function getAncestors(
  graph: Graph,
  nodeId: NodeId,
  opts: { transitive: boolean },
): BlueprintNode[] {
  const seen = new Set<NodeId>();
  const ancestors: BlueprintNode[] = [];
  const queue: NodeId[] = [...(graph.parentsByNodeId.get(nodeId) ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (seen.has(currentId)) continue;
    seen.add(currentId);
    const ancestorNode = graph.nodeById.get(currentId);
    if (ancestorNode) ancestors.push(ancestorNode);
    if (opts.transitive) queue.push(...(graph.parentsByNodeId.get(currentId) ?? []));
  }
  return ancestors;
}

/**
 * Look up the form definition that a node renders.
 *
 * Each node's `data.component_id` references one entry in
 * `BlueprintResponse.forms[]`; a missing form means the wire payload
 * referenced an unknown id (validation should have caught it at boot).
 *
 * @returns The form, or `undefined` if `node.data.component_id` is unknown.
 */
export function getFormForNode(graph: Graph, node: BlueprintNode): BlueprintForm | undefined {
  return graph.formById.get(node.data.component_id);
}
