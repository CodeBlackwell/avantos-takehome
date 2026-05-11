import { describe, expect, test } from "vitest";
import fixture from "./fixtures/graph.json";
import type { BlueprintResponse } from "../src/api/blueprint";
import { buildGraph, getAncestors, getFormForNode } from "../src/graph/graph";

const response = fixture as unknown as BlueprintResponse;
const graph = buildGraph(response);

// Resolve nodes by display name for readability.
const byName = new Map(response.nodes.map((n) => [n.data.name, n]));
const nameOf = (id: string) => graph.nodeById.get(id)?.data.name;

describe("buildGraph", () => {
  /**
   * @businessValue Every form on the canvas must be addressable by the
   * picker; missing a node from the index would silently make it
   * un-mappable and un-resolvable.
   */
  test("indexes every node and form", () => {
    expect(graph.nodeById.size).toBe(response.nodes.length);
    expect(graph.formById.size).toBe(response.forms.length);
  });

  /**
   * @businessValue The "Direct dependencies" section in the picker is
   * derived from the parent index, which is built from `edges` (the
   * canonical source). Drift here would either hide or invent ancestors
   * for the user.
   */
  test("computes parent index from edges", () => {
    expect(graph.parentsByNodeId.get(byName.get("Form A")!.id)).toEqual([]);
    const dParents = graph.parentsByNodeId.get(byName.get("Form D")!.id)!.map(nameOf);
    expect(dParents).toEqual(["Form B"]);
    const fParents = graph.parentsByNodeId.get(byName.get("Form F")!.id)!.map(nameOf);
    expect(fParents.sort()).toEqual(["Form D", "Form E"]);
  });
});

describe("getAncestors", () => {
  const ancestorNames = (id: string, transitive: boolean) =>
    getAncestors(graph, id, { transitive }).map((n) => n.data.name).sort();

  /**
   * @businessValue A form with no upstream forms must show no ancestor
   * options in the picker — surfacing phantom dependencies would mislead
   * the user.
   */
  test("root has no ancestors", () => {
    expect(ancestorNames(byName.get("Form A")!.id, true)).toEqual([]);
  });

  /**
   * @businessValue The "Direct dependencies" section must list only the
   * form's immediate parents.
   */
  test("direct ancestors of D = [B]", () => {
    expect(ancestorNames(byName.get("Form D")!.id, false)).toEqual(["Form B"]);
  });

  /**
   * @businessValue The "Transitive dependencies" section must reach every
   * upstream form so the user can pre-fill from anywhere in the chain.
   */
  test("transitive ancestors of D = [A, B]", () => {
    expect(ancestorNames(byName.get("Form D")!.id, true)).toEqual(["Form A", "Form B"]);
  });

  /**
   * @businessValue When a form has multiple direct parents, all of them
   * must appear in the direct section.
   */
  test("direct ancestors of F = [D, E]", () => {
    expect(ancestorNames(byName.get("Form F")!.id, false)).toEqual(["Form D", "Form E"]);
  });

  /**
   * @businessValue Diamond-shaped DAGs must surface every transitive
   * ancestor exactly once, never duplicated.
   */
  test("transitive ancestors of F = [A, B, C, D, E]", () => {
    expect(ancestorNames(byName.get("Form F")!.id, true)).toEqual([
      "Form A",
      "Form B",
      "Form C",
      "Form D",
      "Form E",
    ]);
  });
});

describe("topoIndex", () => {
  /**
   * @businessValue Topological sort backs the "Topological" sort mode in
   * the form list and the picker — parents must always appear before
   * children, with alpha tiebreaks so order doesn't shift between reloads.
   */
  test("ranks every node, parents before children, alpha tiebreak", () => {
    const order = response.nodes
      .slice()
      .sort((a, b) => graph.topoIndex.get(a.id)! - graph.topoIndex.get(b.id)!)
      .map((n) => n.data.name);
    expect(order).toEqual(["Form A", "Form B", "Form C", "Form D", "Form E", "Form F"]);
  });
});

describe("getFormForNode", () => {
  /**
   * @businessValue Each canvas node points to a form definition by id;
   * resolving the wrong one (or none) would render the picker against
   * the wrong field schema.
   */
  test("resolves a node's form definition", () => {
    const formA = getFormForNode(graph, byName.get("Form A")!);
    expect(formA?.field_schema.properties).toHaveProperty("email");
  });
});
