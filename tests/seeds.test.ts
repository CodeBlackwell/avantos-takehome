import { beforeAll, describe, expect, test } from "vitest";
import type { BlueprintNode, BlueprintResponse } from "../src/api/blueprint";
import { buildGraph } from "../src/graph/graph";
import { extractSeeds } from "../src/app/seeds";
import { loadGlobals } from "../src/prefill/sources/globalsClient";

// nodesSharing reads source.kind via the registry; globals must be loaded
// for the kind check to find the source. (registry.getSource doesn't actually
// require globals to be loaded, but isResolvableIn calls inside extractSeeds
// would. Keeping symmetric with other source-touching tests.)
beforeAll(async () => {
  await loadGlobals();
});

function nodeWithMapping(id: string, mapping: unknown): BlueprintNode {
  return {
    id,
    type: "form",
    position: { x: 0, y: 0 },
    data: {
      id,
      component_id: `${id}-form`,
      component_key: id,
      component_type: "form",
      name: id,
      prerequisites: [],
      permitted_roles: [],
      input_mapping: mapping as Record<string, unknown>,
      sla_duration: { number: 0, unit: "minutes" },
      approval_required: false,
      approval_roles: [],
    },
  };
}

function makeResponse(nodes: BlueprintNode[]): BlueprintResponse {
  // Synth a non-reusable form per node so nodesSharing returns just [nodeId].
  // Tests that want sharing build their own response.
  const forms = nodes.map((n) => ({
    id: n.data.component_id,
    name: n.data.name,
    description: "",
    is_reusable: false,
    field_schema: { type: "object" as const, properties: {}, required: [] },
    ui_schema: { type: "VerticalLayout" as const, elements: [] },
  }));
  return {
    id: "bp",
    tenant_id: "t",
    name: "",
    description: "",
    category: "",
    nodes,
    edges: [],
    forms,
    branches: [],
    triggers: [],
  };
}

const seedsFor = (response: BlueprintResponse) => extractSeeds(response, buildGraph(response));

describe("extractSeeds", () => {
  /**
   * @businessValue When a blueprint ships with default mappings, those
   * defaults must appear pre-filled when the user first opens the form so
   * they don't have to wire common cases by hand.
   */
  test("registry-claimed candidates become seed mappings", () => {
    const seeds = seedsFor(
makeResponse([
        nodeWithMapping("n1", {
          email: { sourceId: "global", groupId: "currentUser", optionId: "email" },
        }),
      ]),
    );
    expect(seeds).toEqual({
      n1: { email: { sourceId: "global", groupId: "currentUser", optionId: "email" } },
    });
  });

  /**
   * @businessValue A node with no `input_mapping` must produce no seeds at
   * all — the user starts with a clean field rather than an empty object
   * that other UI code might mistakenly treat as "mapped".
   */
  test("nodes with missing input_mapping are skipped", () => {
    const seeds = seedsFor(
makeResponse([nodeWithMapping("n1", null), nodeWithMapping("n2", undefined)]),
    );
    expect(seeds).toEqual({});
  });

  /**
   * @businessValue Mal-typed `input_mapping` (string, array) must not crash
   * the load — the user should still see the rest of the blueprint, just
   * without seeded mappings for the offending node.
   */
  test("non-object input_mapping is ignored without throwing", () => {
    const seeds = seedsFor(
makeResponse([nodeWithMapping("n1", "not an object" as unknown)]),
    );
    expect(seeds).toEqual({});
  });

  /**
   * @businessValue Candidates that no source claims must be silently
   * dropped — older blueprints may carry deprecated source ids and we'd
   * rather skip them than render unresolvable chips.
   */
  test("candidates rejected by every source are dropped", () => {
    const seeds = seedsFor(
makeResponse([
        nodeWithMapping("n1", {
          email: { sourceId: "unknown-source", groupId: "x", optionId: "y" },
          name: { sourceId: "global", groupId: "currentUser", optionId: "name" },
        }),
      ]),
    );
    expect(seeds.n1).toEqual({
      name: { sourceId: "global", groupId: "currentUser", optionId: "name" },
    });
    expect(seeds.n1!.email).toBeUndefined();
  });

  /**
   * @businessValue If every candidate on a node is rejected, the node must
   * not appear in the seeds map at all (rather than as an empty `{}`).
   * Empty entries would leak and mis-trigger the bleed-detection logic.
   */
  test("a node with only rejected candidates is omitted from the seed map", () => {
    const seeds = seedsFor(
makeResponse([
        nodeWithMapping("n1", {
          email: { sourceId: "unknown-source", groupId: "x", optionId: "y" },
        }),
      ]),
    );
    expect(seeds).toEqual({});
  });

  /**
   * @businessValue When a form is reusable and a fixture seeds a global
   * mapping on one instance, every sibling instance must see the same
   * seed — that's what "share" means at load time. Without it, two nodes
   * referencing the same form would diverge from the moment the blueprint
   * loads.
   */
  test("global seeds on a reusable form fan out to every sibling instance", () => {
    const sharedFormId = "shared-form";
    const n1 = nodeWithMapping("n1", {
      email: { sourceId: "global", groupId: "currentUser", optionId: "email" },
    });
    n1.data.component_id = sharedFormId;
    const n2 = nodeWithMapping("n2", {});
    n2.data.component_id = sharedFormId;

    const response: BlueprintResponse = {
      id: "bp",
      tenant_id: "t",
      name: "",
      description: "",
      category: "",
      nodes: [n1, n2],
      edges: [],
      forms: [
        {
          id: sharedFormId,
          name: "Shared",
          description: "",
          is_reusable: true,
          field_schema: { type: "object", properties: {}, required: [] },
          ui_schema: { type: "VerticalLayout", elements: [] },
        },
      ],
      branches: [],
      triggers: [],
    };

    const seeds = extractSeeds(response, buildGraph(response));
    const expected = { sourceId: "global", groupId: "currentUser", optionId: "email" };
    expect(seeds.n1).toEqual({ email: expected });
    expect(seeds.n2).toEqual({ email: expected });
  });

  /**
   * @businessValue Graph-source mappings reference upstream nodes whose
   * ancestor relationships differ per instance — sharing them across
   * instances would create unresolvable cross-instance references.
   */
  test("graph-source seeds stay per-node even on reusable forms", () => {
    const sharedFormId = "shared-form";
    const n1 = nodeWithMapping("n1", {
      email: { sourceId: "form-fields-direct", groupId: "some-parent", optionId: "email" },
    });
    n1.data.component_id = sharedFormId;
    const n2 = nodeWithMapping("n2", {});
    n2.data.component_id = sharedFormId;

    const response: BlueprintResponse = {
      id: "bp",
      tenant_id: "t",
      name: "",
      description: "",
      category: "",
      nodes: [n1, n2],
      edges: [],
      forms: [
        {
          id: sharedFormId,
          name: "Shared",
          description: "",
          is_reusable: true,
          field_schema: { type: "object", properties: {}, required: [] },
          ui_schema: { type: "VerticalLayout", elements: [] },
        },
      ],
      branches: [],
      triggers: [],
    };

    const seeds = extractSeeds(response, buildGraph(response));
    expect(seeds.n1?.email).toBeDefined();
    expect(seeds.n2).toBeUndefined();
  });
});
