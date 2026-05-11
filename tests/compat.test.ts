import { describe, expect, test } from "vitest";
import { isCompatible } from "../src/prefill/compat";

describe("isCompatible", () => {
  /**
   * @businessValue The picker enables an option only when the source field's
   * type matches the target. Same-type pairings must always be permitted so
   * the user can wire obvious matches (Email → Email, Multi-select → Multi-select).
   */
  test("same avantos_type is compatible", () => {
    expect(isCompatible("short-text", "short-text")).toBe(true);
    expect(isCompatible("multi-select", "multi-select")).toBe(true);
  });

  /**
   * @businessValue Mismatched types must be rejected so the user can't
   * accidentally wire a button into a text field — preventing silent data
   * corruption at runtime.
   */
  test("different avantos_type is incompatible", () => {
    expect(isCompatible("short-text", "multi-line-text")).toBe(false);
    expect(isCompatible("button", "short-text")).toBe(false);
    expect(isCompatible("object-enum", "checkbox-group")).toBe(false);
  });
});
