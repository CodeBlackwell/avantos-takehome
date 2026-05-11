import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useMappings } from "../src/prefill/useMappings";
import type { Mapping } from "../src/prefill/types";

const NODE = "form-x";
const FIELD = "email";
const MAPPING: Mapping = { sourceId: "global", groupId: "currentUser", optionId: "email" };

beforeEach(() => localStorage.clear());

describe("useMappings", () => {
  /**
   * @businessValue When the user picks then clears a prefill, the chip
   * must come and go reliably — basic interactivity. Without this, the
   * mental model of "I changed my mind" is broken.
   */
  test("set then clear round-trips", () => {
    const { result } = renderHook(() => useMappings());

    act(() => result.current.setMapping(NODE, FIELD, MAPPING));
    expect(result.current.mappings[NODE]?.[FIELD]).toEqual(MAPPING);

    act(() => result.current.clearMapping(NODE, FIELD));
    expect(result.current.mappings[NODE]?.[FIELD]).toBeUndefined();
  });

  /**
   * @businessValue The user's wiring must survive a page reload — that's
   * the whole point of localStorage persistence in this prototype.
   */
  test("persists to localStorage and rehydrates on next mount", () => {
    const first = renderHook(() => useMappings());
    act(() => first.result.current.setMapping(NODE, FIELD, MAPPING));

    const second = renderHook(() => useMappings());
    expect(second.result.current.mappings[NODE]?.[FIELD]).toEqual(MAPPING);
  });
});

describe("seedMappings precedence (bleed #4)", () => {
  const SEED_V1: Mapping = { sourceId: "global", groupId: "currentUser", optionId: "email" };
  const SEED_V2: Mapping = { sourceId: "global", groupId: "currentUser", optionId: "name" };
  const USER_EDIT: Mapping = { sourceId: "global", groupId: "clientOrg", optionId: "name" };

  /**
   * @businessValue When a blueprint ships defaults and the user has not
   * touched them, those defaults must populate the relevant fields.
   */
  test("first seed fills missing entries", () => {
    const { result } = renderHook(() => useMappings());
    act(() => result.current.seedMappings({ [NODE]: { [FIELD]: SEED_V1 } }));
    expect(result.current.mappings[NODE]?.[FIELD]).toEqual(SEED_V1);
  });

  /**
   * @businessValue If the blueprint's defaults change, an unmodified
   * field should pick up the new default — admins iterating on a
   * blueprint expect their changes to flow through.
   */
  test("changed seed replaces a value the user never touched", () => {
    const { result } = renderHook(() => useMappings());
    act(() => result.current.seedMappings({ [NODE]: { [FIELD]: SEED_V1 } }));
    act(() => result.current.seedMappings({ [NODE]: { [FIELD]: SEED_V2 } }));
    expect(result.current.mappings[NODE]?.[FIELD]).toEqual(SEED_V2);
  });

  /**
   * @businessValue But if the user has explicitly chosen a value, no
   * blueprint update may overwrite it — their intentional edit is
   * load-bearing.
   */
  test("user-edited value survives a changed seed", () => {
    const { result } = renderHook(() => useMappings());
    act(() => result.current.seedMappings({ [NODE]: { [FIELD]: SEED_V1 } }));
    act(() => result.current.setMapping(NODE, FIELD, USER_EDIT));
    act(() => result.current.seedMappings({ [NODE]: { [FIELD]: SEED_V2 } }));
    expect(result.current.mappings[NODE]?.[FIELD]).toEqual(USER_EDIT);
  });

  /**
   * @businessValue Clearing a seeded value signals "I want this empty".
   * The next time the same seed is presented (e.g. blueprint reloaded
   * unchanged), it should refill — clearing isn't permanent rejection.
   */
  test("clearing a seeded value lets the next seed pass refill it", () => {
    const { result } = renderHook(() => useMappings());
    act(() => result.current.seedMappings({ [NODE]: { [FIELD]: SEED_V1 } }));
    act(() => result.current.clearMapping(NODE, FIELD));
    act(() => result.current.seedMappings({ [NODE]: { [FIELD]: SEED_V1 } }));
    expect(result.current.mappings[NODE]?.[FIELD]).toEqual(SEED_V1);
  });
});
