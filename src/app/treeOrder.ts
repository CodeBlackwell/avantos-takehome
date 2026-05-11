import type { BlueprintNode, NodeId } from "../api/blueprint";
import type { Graph } from "../graph/graph";

/**
 * One row in the tree-mode rendering script.
 *
 * The DAG is projected to a tree by emitting a node as `"primary"`
 * (interactive) on its first DFS visit and as `"ref"` (read-only,
 * arrow ↗) on every subsequent visit. Under each primary, additional
 * incoming edges from non-canonical parents are surfaced as
 * `"parentRef"` (arrow ↙) so the user sees every parent edge without
 * leaving the node's own subtree.
 */
export type TreeRow =
  | { kind: "primary"; nodeId: NodeId; prefix: string }
  | { kind: "ref"; nodeId: NodeId; prefix: string }
  | { kind: "parentRef"; nodeId: NodeId; parentNodeId: NodeId; prefix: string };

export interface TreeOrder {
  /** Deduped node list (each node once). Drives the form list's data. */
  order: BlueprintNode[];
  /** Rendering script — one entry per visual line in the form list. */
  rows: TreeRow[];
}

/**
 * Build a depth-first tree projection of a DAG.
 *
 * DAG nodes can have multiple parents. The first DFS visit emits the
 * form as a `"primary"` (interactive) row and adds the node to
 * `order`; later visits emit a `"ref"` row at each additional parent
 * so every parent edge is visible. Under a primary row we also list
 * non-canonical parents as `"parentRef"` rows so the user sees every
 * incoming edge without re-traversing the whole subtree (which would
 * duplicate content).
 *
 * Children are sorted alphabetically at every level for determinism;
 * roots are sorted the same way.
 *
 * Cyclic input is handled gracefully: any node not reached by DFS is
 * appended to `order` and emitted as a primary row with no prefix.
 *
 * @returns `{ order, rows }` — `order` is the deduped node list,
 *          `rows` is the rendering script.
 */
export function buildTreeOrder(graph: Graph): TreeOrder {
  const nameOf = (id: NodeId) => graph.nodeById.get(id)?.data.name ?? id;

  // Children-of index, sorted alphabetically. Built once so traversal
  // doesn't re-sort sibling lists at every recursion.
  const childrenOf = new Map<NodeId, NodeId[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) childrenOf.get(edge.source)?.push(edge.target);
  for (const childList of childrenOf.values()) {
    childList.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }

  // Roots = nodes with no incoming edges. Sorted alphabetically.
  const roots = graph.nodes
    .filter((node) => (graph.parentsByNodeId.get(node.id) ?? []).length === 0)
    .map((node) => node.id)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const seen = new Set<NodeId>();
  const order: BlueprintNode[] = [];
  const rows: TreeRow[] = [];

  /**
   * Recursive DFS visitor.
   *
   * `enteredFrom` is the parent we just descended from. Non-null
   * whenever we recurse into a child; `null` only at the root entry.
   * Used to emit `"parentRef"` rows for every OTHER parent of the
   * current node — gives the user a visible breadcrumb to siblings
   * without re-traversing them (which would duplicate subtrees).
   *
   * `prefix`/`isLast`/`isRoot` together drive the box-drawing branch
   * glyphs (`├─`, `└─`, `│`).
   */
  function visit(
    id: NodeId,
    prefix: string,
    isLast: boolean,
    isRoot: boolean,
    enteredFrom: NodeId | null,
  ) {
    const node = graph.nodeById.get(id);
    if (!node) return;
    const myPrefix = prefix + (isRoot ? "" : isLast ? "└─ " : "├─ ");
    if (seen.has(id)) {
      // Already emitted as primary higher up — drop a back-reference
      // marker here so the parent edge stays visible.
      rows.push({ kind: "ref", nodeId: id, prefix: myPrefix });
      return;
    }
    seen.add(id);
    rows.push({ kind: "primary", nodeId: id, prefix: myPrefix });
    order.push(node);

    const childPrefix = prefix + (isRoot ? "" : isLast ? "   " : "│  ");
    // Other incoming parents (excluding the one we descended from).
    // These render as "parentRef" rows so the user sees every parent
    // without us re-traversing those subtrees (which would duplicate).
    const extraParents = enteredFrom
      ? (graph.parentsByNodeId.get(id) ?? [])
          .filter((parentId) => parentId !== enteredFrom)
          .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
      : [];
    const kids = childrenOf.get(id) ?? [];
    const totalChildren = extraParents.length + kids.length;

    extraParents.forEach((parentId, index) => {
      const last = index === totalChildren - 1;
      rows.push({
        kind: "parentRef",
        nodeId: id,
        parentNodeId: parentId,
        prefix: childPrefix + (last ? "└─ " : "├─ "),
      });
    });
    kids.forEach((kidId, index) => {
      const overallIndex = extraParents.length + index;
      visit(kidId, childPrefix, overallIndex === totalChildren - 1, false, id);
    });
  }

  roots.forEach((id, index) => visit(id, "", index === roots.length - 1, true, null));

  // Defensive sweep for nodes unreachable from any root (cycle or
  // orphan). Append them in declaration order so they still render.
  for (const node of graph.nodes) {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      order.push(node);
      rows.push({ kind: "primary", nodeId: node.id, prefix: "" });
    }
  }
  return { order, rows };
}
