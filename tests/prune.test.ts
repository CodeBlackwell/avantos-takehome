import { beforeAll, describe, expect, test } from "vitest";
import fixture from "./fixtures/graph.json";
import type { BlueprintResponse } from "../src/api/blueprint";
import { buildGraph } from "../src/graph/graph";
import { pruneDeadMappings } from "../src/app/prune";
import { loadGlobals } from "../src/prefill/sources/globalsClient";
import type { Mapping } from "../src/prefill/types";
import type { MappingsState } from "../src/prefill/useMappings";

// Prune calls globalDataSource.isResolvableIn synchronously against the
// globals cache. App.tsx primes that cache at boot; tests do the same.
beforeAll(async () => {
  await loadGlobals();
});

const graph = buildGraph(fixture as unknown as BlueprintResponse);
const byName = (name: string) => graph.nodes.find((n) => n.data.name === name)!;

const formA = byName("Form A");
const formB = byName("Form B");
const formD = byName("Form D");

const liveDirect: Mapping = { sourceId: "form-fields-direct", groupId: formB.id, optionId: "email" };
const liveTransitive: Mapping = { sourceId: "form-fields-transitive", groupId: formA.id, optionId: "email" };
const liveGlobal: Mapping = { sourceId: "global", groupId: "currentUser", optionId: "email" };

describe("pruneDeadMappings", () => {
  /**
   * @businessValue When the user reloads the same blueprint, every still-valid
   * wiring must survive — prune is conservative and never deletes mappings
   * that resolve cleanly against the current graph.
   */
  test("keeps live form-field, transitive, and global mappings", () => {
    const input: MappingsState = {
      [formD.id]: { email: liveDirect, name: liveTransitive, notes: liveGlobal },
    };
    const out = pruneDeadMappings(graph, input);
    expect(out[formD.id]).toEqual({ email: liveDirect, name: liveTransitive, notes: liveGlobal });
  });

  /**
   * @businessValue Switching blueprints must not leave stale chips
   * referencing nodes that don't exist anymore — bleed across blueprints
   * was the original UX bug this prune pass was added to fix.
   */
  test("drops entries for nodes not in the current graph (bleed #1)", () => {
    const input: MappingsState = {
      "form-from-other-blueprint": { email: liveGlobal },
      [formD.id]: { email: liveDirect },
    };
    const out = pruneDeadMappings(graph, input);
    expect(out["form-from-other-blueprint"]).toBeUndefined();
    expect(out[formD.id]).toEqual({ email: liveDirect });
  });

  /**
   * @businessValue If a form's schema is updated to remove a field, the
   * prefill mapping for that field is meaningless and must be dropped so
   * the user is not shown a chip that resolves to nothing.
   */
  test("drops mappings whose target field no longer exists on the form", () => {
    const input: MappingsState = {
      [formD.id]: { renamed_field: liveDirect, email: liveDirect },
    };
    const out = pruneDeadMappings(graph, input);
    expect(out[formD.id]).toEqual({ email: liveDirect });
  });

  /**
   * @businessValue Direct vs. transitive is a meaningful distinction in the
   * UI; a mapping claiming "direct" against a form that's actually
   * transitive must be pruned so the user doesn't see a dependency chip
   * in the wrong category.
   */
  test("drops form-field mappings whose source ancestor isn't in scope (bleed #2)", () => {
    // Form A is a transitive ancestor of Form D, NOT a direct parent.
    // A mapping that claims form-fields-direct on Form A is dead.
    const wrongMode: Mapping = { sourceId: "form-fields-direct", groupId: formA.id, optionId: "email" };
    const input: MappingsState = { [formD.id]: { email: wrongMode } };
    const out = pruneDeadMappings(graph, input);
    expect(out[formD.id]).toBeUndefined();
  });

  /**
   * @businessValue If an upstream form drops a field, the downstream
   * mapping pointing at it is unresolvable and must be cleared.
   */
  test("drops form-field mappings whose option no longer exists on the source form", () => {
    const ghost: Mapping = { sourceId: "form-fields-direct", groupId: formB.id, optionId: "deleted_field" };
    const input: MappingsState = { [formD.id]: { email: ghost } };
    const out = pruneDeadMappings(graph, input);
    expect(out[formD.id]).toBeUndefined();
  });

  /**
   * @businessValue If a global key (e.g. `currentUser.email`) is renamed
   * or a whole group is removed, persisted mappings must be pruned so
   * runtime resolve never returns undefined for a chip the user thinks
   * is wired.
   */
  test("drops global mappings whose group/key isn't registered (bleed #3)", () => {
    const ghostGroup: Mapping = { sourceId: "global", groupId: "weatherApi", optionId: "temp" };
    const ghostKey: Mapping = { sourceId: "global", groupId: "currentUser", optionId: "deleted_key" };
    const input: MappingsState = {
      [formD.id]: { name: ghostGroup, notes: ghostKey, email: liveGlobal },
    };
    const out = pruneDeadMappings(graph, input);
    expect(out[formD.id]).toEqual({ email: liveGlobal });
  });

  /**
   * @businessValue Removing a source from the registry (a deployment-level
   * change) must take its persisted mappings with it; otherwise the user
   * sees a chip backed by code that no longer exists.
   */
  test("drops mappings whose source has been removed from the registry", () => {
    const orphan: Mapping = { sourceId: "removed-source", groupId: "x", optionId: "y" };
    const input: MappingsState = { [formD.id]: { email: orphan } };
    const out = pruneDeadMappings(graph, input);
    expect(out[formD.id]).toBeUndefined();
  });
});
