/**
 * @file Pure helpers over `BlueprintForm`.
 *
 * Kept separate from `blueprint.ts` so the types module stays a flat
 * description of the wire payload — no derived logic, no traversal.
 */

import type {
  BlueprintForm,
  FieldKey,
  UiSchema,
  UiSchemaElement,
} from "./blueprint";

/** JsonForms scope-pointer prefix that introduces a property reference. */
const SCOPE_PREFIX = "#/properties/";

/**
 * Render-order list of field keys for a form.
 *
 * Honors `ui_schema` first (recursing through layouts), then appends
 * any `field_schema.properties` keys not referenced by `ui_schema` in
 * declaration order. Fixtures with empty `ui_schema` fall through
 * cleanly to declaration order.
 *
 * Returns *all* field keys, including non-prefillable types like
 * `"button"` — the source-side picker still needs every field so its
 * "disabled but visible" rows stay intact (CLAUDE.md rule 7). The
 * target-side filter happens in `FormList.tsx`.
 */
export function getFieldOrder(form: BlueprintForm): FieldKey[] {
  const seen = new Set<FieldKey>();
  const orderedKeys: FieldKey[] = [];
  walkUiSchema(form.ui_schema, (fieldKey) => {
    if (form.field_schema.properties[fieldKey] && !seen.has(fieldKey)) {
      seen.add(fieldKey);
      orderedKeys.push(fieldKey);
    }
  });
  // Append any properties not referenced in the ui_schema. Preserves
  // declaration order so the picker matches the JSON source.
  for (const fieldKey of Object.keys(form.field_schema.properties)) {
    if (!seen.has(fieldKey)) orderedKeys.push(fieldKey);
  }
  return orderedKeys;
}

/** Whether a field appears in the form's `required` array. */
export function isRequired(form: BlueprintForm, fieldKey: FieldKey): boolean {
  return form.field_schema.required.includes(fieldKey);
}

/**
 * Walk the ui_schema tree, invoking `visit(fieldKey)` for each leaf
 * Control/Button whose `scope` resolves a property reference.
 *
 * Recursion terminates at any node carrying a `scope` (the leaf marker);
 * layout nodes recurse into their `elements`.
 */
function walkUiSchema(node: UiSchema | UiSchemaElement, visit: (fieldKey: FieldKey) => void): void {
  if ("scope" in node) {
    if (node.scope.startsWith(SCOPE_PREFIX)) visit(node.scope.slice(SCOPE_PREFIX.length));
    return;
  }
  for (const child of node.elements) walkUiSchema(child, visit);
}
