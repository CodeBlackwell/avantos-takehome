import { describe, expect, test } from "vitest";
import fixture from "./fixtures/graph.json";
import { validateBlueprint } from "../src/api/validateBlueprint";

// Deep-clone helper so each test mutates an isolated copy.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("validateBlueprint", () => {
  /**
   * @businessValue The canonical fixture must pass validation; otherwise
   * the validator is mismatched with the upstream wire format and every
   * load throws.
   */
  test("accepts the canonical fixture", () => {
    expect(() => validateBlueprint(fixture, "fixture")).not.toThrow();
  });

  /**
   * @businessValue A typo'd avantos_type would silently break compat
   * checks and field rendering. Validator must reject at boot with a
   * path that points the developer at the offending property.
   */
  test("rejects an unknown avantos_type and names the path", () => {
    const bad = clone(fixture) as unknown as {
      forms: { field_schema: { properties: Record<string, { avantos_type: string }> } }[];
    };
    bad.forms[0]!.field_schema.properties.email!.avantos_type = "shrt-text";
    expect(() => validateBlueprint(bad, "test")).toThrow(/avantos_type.*shrt-text/);
  });

  /**
   * @businessValue If a node references a component_id that doesn't exist
   * in forms[], the picker would render the form with no fields. The
   * validator catches it at the boundary.
   */
  test("rejects a node whose component_id is not in forms[]", () => {
    const bad = clone(fixture) as unknown as {
      nodes: { data: { component_id: string } }[];
    };
    bad.nodes[0]!.data.component_id = "f-does-not-exist";
    expect(() => validateBlueprint(bad, "test")).toThrow(/unknown form/);
  });

  /**
   * @businessValue An edge to a non-existent node would create a parent
   * relationship to nothing; prune would silently drop it but it points
   * at a fixture bug worth surfacing.
   */
  test("rejects an edge whose source/target is not a known node", () => {
    const bad = clone(fixture) as unknown as {
      edges: { source: string; target: string }[];
    };
    bad.edges[0]!.source = "node-that-does-not-exist";
    expect(() => validateBlueprint(bad, "test")).toThrow(/unknown node/);
  });

  /**
   * @businessValue Top-level required strings must be present so the
   * AppShell can render header text without runtime undefined checks.
   */
  test("rejects when a required top-level string is missing", () => {
    const bad = clone(fixture) as unknown as Record<string, unknown>;
    delete bad.name;
    expect(() => validateBlueprint(bad, "test")).toThrow(/name.*expected string/);
  });
});
