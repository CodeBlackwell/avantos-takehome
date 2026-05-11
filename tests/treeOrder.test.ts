import { describe, expect, test } from "vitest";
import fixture from "./fixtures/graph.json";
import type { BlueprintEdge, BlueprintNode, BlueprintResponse } from "../src/api/blueprint";
import { buildGraph } from "../src/graph/graph";
import { buildTreeOrder } from "../src/app/treeOrder";

const fixtureResponse = fixture as unknown as BlueprintResponse;
const fixtureGraph = buildGraph(fixtureResponse);
const fixtureNameOf = (id: string) => fixtureGraph.nodeById.get(id)?.data.name ?? id;

function makeNode(id: string, name: string): BlueprintNode {
  return {
    id,
    type: "form",
    position: { x: 0, y: 0 },
    data: {
      id,
      component_id: `${id}-form`,
      component_key: id,
      component_type: "form",
      name,
      prerequisites: [],
      permitted_roles: [],
      input_mapping: {},
      sla_duration: { number: 0, unit: "minutes" },
      approval_required: false,
      approval_roles: [],
    },
  };
}

function makeResponse(nodes: BlueprintNode[], edges: BlueprintEdge[]): BlueprintResponse {
  return {
    id: "bp_test",
    tenant_id: "t",
    name: "test",
    description: "",
    category: "",
    nodes,
    edges,
    forms: [],
    branches: [],
    triggers: [],
  };
}

describe("buildTreeOrder", () => {
  /**
   * @businessValue When a user views the form list in tree-sort mode, every
   * form must appear in dependency order so they can scan upstream-to-downstream
   * without losing context. A linear chain is the simplest reading shape and
   * must render exactly once per node.
   */
  test("linear chain A→B→C produces three primary rows in order", () => {
    const nodes = [makeNode("a", "A"), makeNode("b", "B"), makeNode("c", "C")];
    const edges: BlueprintEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const { order, rows } = buildTreeOrder(buildGraph(makeResponse(nodes, edges)));

    expect(order.map((n) => n.data.name)).toEqual(["A", "B", "C"]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "primary")).toBe(true);
  });

  /**
   * @businessValue Independent root forms must each be their own subtree so
   * the user can see disjoint workflows side-by-side. Roots are sorted
   * alphabetically so the order is deterministic across reloads.
   */
  test("multi-root graphs render each root as its own subtree, alpha-sorted", () => {
    const nodes = [
      makeNode("z", "Zeta"),
      makeNode("a", "Alpha"),
      makeNode("a-child", "Alpha child"),
    ];
    const edges: BlueprintEdge[] = [{ source: "a", target: "a-child" }];
    const { order } = buildTreeOrder(buildGraph(makeResponse(nodes, edges)));

    expect(order.map((n) => n.data.name)).toEqual(["Alpha", "Alpha child", "Zeta"]);
  });

  /**
   * @businessValue A form with multiple parents (a join in the DAG) is reached
   * along multiple paths. The user must see the form once as an editable
   * "primary" row plus one read-only "ref" row at every additional parent so
   * no incoming edge is hidden.
   */
  test("multi-parent join emits a primary row plus a ref row at the second parent", () => {
    const nodes = [
      makeNode("a", "A"),
      makeNode("b", "B"),
      makeNode("c", "C"),
    ];
    const edges: BlueprintEdge[] = [
      { source: "a", target: "c" },
      { source: "b", target: "c" },
    ];
    const { order, rows } = buildTreeOrder(buildGraph(makeResponse(nodes, edges)));

    expect(order.map((n) => n.data.name)).toEqual(["A", "C", "B"]);
    const cRows = rows.filter((r) => r.nodeId === "c");
    // C is reached first from A (primary) with B emitted as a parentRef
    // beneath it; the second visit through B's subtree adds a ref row.
    expect(cRows.map((r) => r.kind).sort()).toEqual(["parentRef", "primary", "ref"]);
  });

  /**
   * @businessValue When a form has multiple parents but is reached first via
   * one of them, the *other* parents must still be visible inside that form's
   * own subtree as parentRef rows (↙). Without this, a user reading the tree
   * could miss an incoming dependency entirely.
   */
  test("non-canonical parents render as parentRef rows under the primary row", () => {
    // Use the fixture: Form F is reached first via Form D (alpha-first parent),
    // and Form E is its other parent → should appear as a parentRef under F.
    const { rows } = buildTreeOrder(fixtureGraph);
    const fNode = fixtureGraph.nodes.find((n) => n.data.name === "Form F")!;
    const eNode = fixtureGraph.nodes.find((n) => n.data.name === "Form E")!;

    const parentRef = rows.find(
      (r) => r.kind === "parentRef" && r.nodeId === fNode.id && r.parentNodeId === eNode.id,
    );
    expect(parentRef).toBeDefined();
  });

  /**
   * @businessValue Every node in the response must appear in the rendered
   * order exactly once, even if the DAG has disconnected components or
   * unreachable nodes — otherwise the user could lose access to a form
   * entirely.
   */
  test("every node appears in `order` exactly once, including orphans", () => {
    const orphan = makeNode("orphan", "Orphan");
    const nodes = [...fixtureResponse.nodes, orphan];
    const { order } = buildTreeOrder(buildGraph(makeResponse(nodes, fixtureResponse.edges)));

    const ids = order.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("orphan");
    expect(ids.length).toBe(nodes.length);
  });

  /**
   * @businessValue Tree row prefixes drive the visual indent in the UI; if
   * they drift the hierarchy renders flat or jagged. Locking the prefixes for
   * a known fixture catches accidental whitespace/glyph changes.
   */
  test("fixture tree prefixes encode the visible hierarchy", () => {
    const { rows } = buildTreeOrder(fixtureGraph);
    const labelled = rows.map((r) => `${r.prefix}${fixtureNameOf(r.nodeId)}[${r.kind}]`);

    expect(labelled[0]).toBe("Form A[primary]");
    expect(labelled.some((l) => l.startsWith("├─ Form B[primary]"))).toBe(true);
    expect(labelled.some((l) => l.includes("Form F[ref]") || l.includes("Form F[primary]"))).toBe(
      true,
    );
  });
});
