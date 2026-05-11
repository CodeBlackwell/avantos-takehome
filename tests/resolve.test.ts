import { describe, expect, test } from "vitest";
import fixture from "./fixtures/graph.json";
import type { BlueprintResponse } from "../src/api/blueprint";
import { buildGraph } from "../src/graph/graph";
import { sources, getSource } from "../src/prefill/registry";
import type { Mapping, SourceCtx } from "../src/prefill/types";

const graph = buildGraph(fixture as unknown as BlueprintResponse);
const byName = (name: string) => graph.nodes.find((n) => n.data.name === name)!;

const formA = byName("Form A");
const formD = byName("Form D");

const submissions = {
  [formA.id]: { email: "ada@upstream.test", name: "Ada" },
};

const ctx: SourceCtx = {
  targetNodeId: formD.id,
  graph,
  submissions,
};

describe("registry", () => {
  /**
   * @businessValue The shipping set of prefill sources is the contract
   * between the picker and the rest of the app. Any addition or removal
   * here changes the user-visible options and must be intentional.
   */
  test("ships direct + transitive + global + endpoint", () => {
    expect(sources.map((s) => s.id)).toEqual([
      "form-fields-direct",
      "form-fields-transitive",
      "global",
      "endpoint",
    ]);
  });
});

describe("resolve round-trip", () => {
  /**
   * @businessValue When the action runs, a transitive prefill mapping must
   * fetch the value from the upstream form's submission so the user's
   * wiring is what actually flows at runtime.
   */
  test("transitive form-field mapping resolves to upstream submission", async () => {
    const mapping: Mapping = {
      sourceId: "form-fields-transitive",
      groupId: formA.id,
      optionId: "email",
    };
    const source = getSource(mapping.sourceId)!;
    expect(await source.resolve(mapping, ctx)).toBe("ada@upstream.test");
  });

  /**
   * @businessValue Global mappings (currentUser, clientOrg) must resolve
   * to their canonical constant values regardless of submissions, so the
   * user can rely on them as a stable source.
   */
  test("global mapping resolves to the constant", async () => {
    const mapping: Mapping = {
      sourceId: "global",
      groupId: "currentUser",
      optionId: "email",
    };
    const source = getSource(mapping.sourceId)!;
    expect(await source.resolve(mapping, ctx)).toBe("ada@example.com");
  });

  /**
   * @businessValue If an upstream form hasn't been submitted yet, the
   * resolver must return undefined rather than crash — letting downstream
   * forms render with an empty value instead of breaking the whole flow.
   */
  test("missing submission resolves to undefined (no throw)", async () => {
    const mapping: Mapping = {
      sourceId: "form-fields-transitive",
      groupId: formA.id,
      optionId: "notes",
    };
    const source = getSource(mapping.sourceId)!;
    expect(await source.resolve(mapping, ctx)).toBeUndefined();
  });
});
