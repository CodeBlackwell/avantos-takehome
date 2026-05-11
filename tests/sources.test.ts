import { beforeAll, describe, expect, test } from "vitest";
import fixture from "./fixtures/graph.json";
import type { BlueprintResponse } from "../src/api/blueprint";
import { buildGraph } from "../src/graph/graph";
import { formFieldsSource } from "../src/prefill/sources/formFieldsSource";
import { globalDataSource } from "../src/prefill/sources/globalDataSource";
import { loadGlobals } from "../src/prefill/sources/globalsClient";
import type { SourceCtx } from "../src/prefill/types";

// Globals are lazily loaded; describe() and isResolvableIn() read from a sync
// cache that's empty until loadGlobals() resolves. App.tsx awaits it on boot
// for the same reason — tests have to do the same.
beforeAll(async () => {
  await loadGlobals();
});

// Adding a new prefill source? Append a `describe(<your source>, ...)` block
// below mirroring the globalDataSource pattern. At minimum, cover:
//   ─ getGroups returns the expected groups/options for a known ctx
//   ─ describe() projects the right triggerLabel / sourceFormName / sourceFieldTitle
//   ─ isResolvableIn() returns true for live mappings, false for stale ones
//   ─ validateMapping() claims its own shape and rejects others (covered
//     transitively by the registry; add direct cases if shape is non-trivial)

const graph = buildGraph(fixture as unknown as BlueprintResponse);
const byName = (name: string) => graph.nodes.find((n) => n.data.name === name)!;

const ctxFor = (targetName: string): SourceCtx => ({
  targetNodeId: byName(targetName).id,
  graph,
});

describe("formFieldsSource", () => {
  const direct = formFieldsSource("direct");
  const transitive = formFieldsSource("transitive");

  /**
   * @businessValue When the user opens the picker on a child form, the
   * "Direct dependencies" section must list only its immediate parents so
   * mappings stay close to the form they depend on.
   */
  test("direct groups for Form D = [Form B]", async () => {
    const groups = await direct.getGroups(ctxFor("Form D"));
    expect(groups.map((g) => g.label)).toEqual(["Form B"]);
  });

  /**
   * @businessValue The "Transitive dependencies" section must exclude direct
   * parents so the two sections never overlap; otherwise the user sees the
   * same form twice and is uncertain which to pick.
   */
  test("transitive groups for Form D excludes the direct parent = [Form A]", async () => {
    const groups = await transitive.getGroups(ctxFor("Form D"));
    expect(groups.map((g) => g.label)).toEqual(["Form A"]);
  });

  /**
   * @businessValue Together, direct + transitive must surface every upstream
   * form available for prefill — no ancestor is hidden, none is duplicated.
   */
  test("direct + transitive partition Form F's full ancestor set", async () => {
    const d = (await direct.getGroups(ctxFor("Form F"))).map((g) => g.label).sort();
    const t = (await transitive.getGroups(ctxFor("Form F"))).map((g) => g.label).sort();
    expect(d).toEqual(["Form D", "Form E"]);
    expect(t).toEqual(["Form A", "Form B", "Form C"]);
    expect([...d, ...t].length).toBe(new Set([...d, ...t]).size);
  });

  /**
   * @businessValue Per CLAUDE.md rule 7, the picker must show every field of
   * the upstream form including button-typed fields. Hiding any field would
   * make some legitimate prefill choices invisible.
   */
  test("group options expose every field of the ancestor's form, including button", async () => {
    const [groupB] = await direct.getGroups(ctxFor("Form D"));
    const optionIds = groupB!.options.map((o) => o.id).sort();
    expect(optionIds).toEqual([
      "button",
      "dynamic_checkbox_group",
      "dynamic_object",
      "email",
      "id",
      "multi_select",
      "name",
      "notes",
    ]);
  });

  /**
   * @businessValue The chip on a mapped field must read "<form>.<field>" with
   * the upstream form's display name and the field's human title — that text
   * is the user's primary feedback that they wired the right thing.
   */
  test("describe() projects '<formName>.<fieldTitle>' from a graph mapping", () => {
    const formB = byName("Form B");
    const projection = direct.describe(
      { sourceId: "form-fields-direct", groupId: formB.id, optionId: "email" },
      graph,
    );
    expect(projection.triggerLabel).toBe("Form B.Email");
    expect(projection.sourceFormName).toBe("Form B");
    expect(projection.sourceFieldTitle).toBe("Email");
  });

  /**
   * @businessValue When a form's field has no `title`, the picker must still
   * render a meaningful label rather than a blank — falling back to the
   * field key keeps the UI usable for un-titled schemas.
   */
  test("describe() falls back to the field key when no title is set", () => {
    const formB = byName("Form B");
    const projection = direct.describe(
      { sourceId: "form-fields-direct", groupId: formB.id, optionId: "multi_select" },
      graph,
    );
    expect(projection.triggerLabel).toBe("Form B.multi_select");
  });

  /**
   * @businessValue After loading a new blueprint, the prune pass must drop
   * any persisted mapping whose upstream form is no longer an ancestor of
   * the target — otherwise stale mappings bleed across blueprints.
   */
  test("isResolvableIn() returns true for a current ancestor + valid field", () => {
    const formB = byName("Form B");
    const ok = direct.isResolvableIn(
      { sourceId: "form-fields-direct", groupId: formB.id, optionId: "email" },
      ctxFor("Form D"),
    );
    expect(ok).toBe(true);
  });

  /**
   * @businessValue When the upstream form is removed from a blueprint or
   * the targeted field disappears, the persisted mapping must be reported
   * as dead so prune drops it.
   */
  test("isResolvableIn() returns false for a non-ancestor or missing field", () => {
    const formC = byName("Form C"); // not an ancestor of Form D
    expect(
      direct.isResolvableIn(
        { sourceId: "form-fields-direct", groupId: formC.id, optionId: "email" },
        ctxFor("Form D"),
      ),
    ).toBe(false);

    const formB = byName("Form B");
    expect(
      direct.isResolvableIn(
        { sourceId: "form-fields-direct", groupId: formB.id, optionId: "no_such_field" },
        ctxFor("Form D"),
      ),
    ).toBe(false);
  });
});

describe("globalDataSource", () => {
  /**
   * @businessValue The picker's Global section must consistently expose
   * exactly the documented globals; adding/removing one without updating
   * downstream contracts would break every blueprint silently.
   */
  test("exposes currentUser + clientOrg groups", async () => {
    const groups = await globalDataSource.getGroups(ctxFor("Form A"));
    expect(groups.map((g) => g.id).sort()).toEqual(["clientOrg", "currentUser"]);
  });

  /**
   * @businessValue The currentUser global must always carry id/email/name —
   * any blueprint relying on these for prefill assumes they are present.
   */
  test("currentUser group lists email + id + name", async () => {
    const groups = await globalDataSource.getGroups(ctxFor("Form A"));
    const user = groups.find((g) => g.id === "currentUser")!;
    expect(user.options.map((o) => o.id).sort()).toEqual(["email", "id", "name"]);
  });

  /**
   * @businessValue The chip on a global mapping must display the friendly
   * group label (e.g. "Action Properties") not the raw key (`currentUser`),
   * so non-engineers can read it.
   */
  test("describe() uses the human group label, not the raw groupId", () => {
    const projection = globalDataSource.describe(
      { sourceId: "global", groupId: "currentUser", optionId: "email" },
      graph,
    );
    expect(projection.triggerLabel).toBe("Action Properties.email");
    expect(projection.sourceFormName).toBe("Action Properties");
    expect(projection.sourceFieldTitle).toBe("email");
  });

  /**
   * @businessValue Prune must keep valid global mappings on blueprint
   * reload; users would lose work otherwise.
   */
  test("isResolvableIn() is true for a known global field", () => {
    expect(
      globalDataSource.isResolvableIn(
        { sourceId: "global", groupId: "currentUser", optionId: "email" },
        ctxFor("Form A"),
      ),
    ).toBe(true);
  });

  /**
   * @businessValue If a global key is renamed or removed, prune must drop
   * the mapping so the user is not left with an unresolvable chip.
   */
  test("isResolvableIn() is false for an unknown group or option", () => {
    expect(
      globalDataSource.isResolvableIn(
        { sourceId: "global", groupId: "nope", optionId: "email" },
        ctxFor("Form A"),
      ),
    ).toBe(false);
    expect(
      globalDataSource.isResolvableIn(
        { sourceId: "global", groupId: "currentUser", optionId: "no_such" },
        ctxFor("Form A"),
      ),
    ).toBe(false);
  });
});
