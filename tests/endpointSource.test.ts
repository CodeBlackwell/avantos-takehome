import { afterEach, describe, expect, test } from "vitest";
import fixture from "./fixtures/graph.json";
import type { BlueprintResponse } from "../src/api/blueprint";
import { clearEndpointCache } from "../src/api/endpoints";
import { buildGraph } from "../src/graph/graph";
import { endpointSource } from "../src/prefill/sources/endpointSource";
import type { Mapping, SourceCtx } from "../src/prefill/types";

const graph = buildGraph(fixture as unknown as BlueprintResponse);
const byName = (name: string) => graph.nodes.find((n) => n.data.name === name)!;

const ctxFor = (targetName: string): SourceCtx => ({
  targetNodeId: byName(targetName).id,
  graph,
});

afterEach(() => clearEndpointCache());

describe("endpointSource", () => {
  /**
   * @businessValue The picker must surface the target form's
   * dynamic_field_config endpoints as prefill groups so a user can wire any
   * compatible field directly to an endpoint option. Without this, the
   * dynamic_field_config payload field is dead weight.
   */
  test("getGroups returns one group per dynamic field on the target form", async () => {
    // Form A has `button`, `dynamic_checkbox_group`, `dynamic_object` configs.
    const groups = await endpointSource.getGroups(ctxFor("Form A"));
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.options.length).toBeGreaterThan(0);
    }
  });

  /**
   * @businessValue Forms without dynamic_field_config must produce no
   * endpoint groups — adding empty groups would clutter the picker for
   * the common case.
   */
  test("getGroups is empty when the target form has no dynamic_field_config", async () => {
    // Synth a form with no dynamic config.
    const synth = {
      ...(fixture as unknown as BlueprintResponse),
      forms: (fixture as unknown as BlueprintResponse).forms.map((f) => ({
        ...f,
        dynamic_field_config: {},
      })),
    };
    const synthGraph = buildGraph(synth);
    const node = synth.nodes[0]!;
    const groups = await endpointSource.getGroups({
      targetNodeId: node.id,
      graph: synthGraph,
    });
    expect(groups).toEqual([]);
  });

  /**
   * @businessValue resolve() must return the actual endpoint item the user
   * picked, so downstream consumers receive the same object the picker
   * advertised at wire time.
   */
  test("resolve returns the matching endpoint item", async () => {
    const groups = await endpointSource.getGroups(ctxFor("Form A"));
    const buttonGroup = groups[0]!;
    const firstOpt = buttonGroup.options[0]!;
    const mapping: Mapping = {
      sourceId: "endpoint",
      groupId: buttonGroup.id,
      optionId: firstOpt.id,
    };
    const value = await endpointSource.resolve(mapping, ctxFor("Form A"));
    expect((value as { id: string }).id).toBe(firstOpt.id);
  });

  /**
   * @businessValue When a target form drops a dynamic_field_config entry
   * (or a deployment removes the endpoint), persisted mappings pointing at
   * it must be pruned so the user is not shown a chip backed by nothing.
   */
  test("isResolvableIn returns false when the dynamic_field_config no longer references the endpoint", () => {
    const synth = {
      ...(fixture as unknown as BlueprintResponse),
      forms: (fixture as unknown as BlueprintResponse).forms.map((f) => ({
        ...f,
        dynamic_field_config: {},
      })),
    };
    const synthGraph = buildGraph(synth);
    const node = synth.nodes.find((n) => n.data.name === "Form A")!;
    const stale: Mapping = {
      sourceId: "endpoint",
      groupId: `${node.data.component_id}::button::te_01jk7ap2r0ewfbrfd53sx46hd2`,
      optionId: "te1-opt-priority",
    };
    expect(
      endpointSource.isResolvableIn(stale, {
        targetNodeId: node.id,
        graph: synthGraph,
      }),
    ).toBe(false);
  });

  /**
   * @businessValue describe() must produce a chip label that names the
   * dynamic field, otherwise the user can't tell endpoint-backed mappings
   * apart from a global or graph mapping at a glance.
   */
  test("describe returns a chip label keyed off the dynamic field title", async () => {
    const groups = await endpointSource.getGroups(ctxFor("Form A"));
    const buttonGroup = groups.find((g) => g.id.includes("::button::"))!;
    const firstOpt = buttonGroup.options[0]!;
    const mapping: Mapping = {
      sourceId: "endpoint",
      groupId: buttonGroup.id,
      optionId: firstOpt.id,
    };
    const projection = endpointSource.describe(mapping, graph);
    expect(projection.triggerLabel).toMatch(/^Button \(endpoint\)\./);
  });

  /**
   * @businessValue Mappings from other sources must not be claimed by the
   * endpoint source — validateMapping is the contract that keeps source
   * boundaries clean.
   */
  test("validateMapping rejects mappings owned by other sources", () => {
    expect(
      endpointSource.validateMapping({
        sourceId: "global",
        groupId: "currentUser",
        optionId: "email",
      }),
    ).toBeNull();
  });
});
