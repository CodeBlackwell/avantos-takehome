/**
 * @file Runtime shape check for `BlueprintResponse`.
 *
 * Called once per JSON import in `localBlueprints.ts`, so mistakes in
 * fixture files (typo in `avantos_type`, missing field, dangling
 * `component_id`, edge to a non-existent node, …) fail loudly at app
 * boot instead of producing mystery undefined-traversal bugs deep in
 * the picker.
 *
 * Performance budget: trivial — a handful of JSON files × walked once
 * at import time. We deliberately *don't* validate the live server's
 * response (different trust boundary, different failure mode).
 *
 * Error messages are formatted as `"<source>: <path>: <message>"` so
 * a bad fixture is traceable back to the file that produced it.
 */

import type {
  AvantosType,
  BlueprintResponse,
  DynamicFieldConfig,
  UiSchema,
  UiSchemaElement,
} from "./blueprint";

/** Closed set; mirrors the `AvantosType` union. */
const AVANTOS_TYPES: ReadonlySet<AvantosType> = new Set<AvantosType>([
  "button",
  "checkbox-group",
  "multi-line-text",
  "multi-select",
  "object-enum",
  "short-text",
]);

const LAYOUT_TYPES = new Set(["VerticalLayout", "HorizontalLayout"]);
const ELEMENT_TYPES = new Set(["Control", "Button"]);

/** Throws with a `<source>: <path>: <message>` shape. */
class BlueprintShapeError extends Error {
  constructor(source: string, path: string, message: string) {
    super(`${source}: ${path}: ${message}`);
    this.name = "BlueprintShapeError";
  }
}

/** Throw helper. Typed `never` so callers can use it in expression position. */
const fail = (source: string, path: string, message: string): never => {
  throw new BlueprintShapeError(source, path, message);
};

/** True for plain objects (excludes `null` and arrays). */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function expectString(value: unknown, source: string, path: string): string {
  if (typeof value !== "string") fail(source, path, `expected string, got ${typeOf(value)}`);
  return value as string;
}

function expectBool(value: unknown, source: string, path: string): boolean {
  if (typeof value !== "boolean") fail(source, path, `expected boolean, got ${typeOf(value)}`);
  return value as boolean;
}

function expectArray(value: unknown, source: string, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BlueprintShapeError(source, path, `expected array, got ${typeOf(value)}`);
  }
  return value;
}

function expectObject(value: unknown, source: string, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new BlueprintShapeError(source, path, `expected object, got ${typeOf(value)}`);
  }
  return value;
}

/** Friendly type tag for error messages — distinguishes `null` and arrays from `"object"`. */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Walk an unknown JSON payload and assert it conforms to
 * `BlueprintResponse`. Returns the same value re-typed on success;
 * throws `BlueprintShapeError` with `<source>: <path>: <message>` on
 * the first failure (fail-fast — the goal is a clean diagnostic, not a
 * report).
 *
 * Cross-references checked here:
 *   - `nodes[*].data.component_id` must reference a known form id.
 *   - `edges[*].source/target` must reference known node ids.
 *   - `forms[*].field_schema.required[*]` must reference known field keys.
 *   - `forms[*].dynamic_field_config` keys must reference known field keys.
 *
 * @param raw    Decoded JSON payload (`unknown`).
 * @param source Free-form label (filename, URL) used in error messages.
 */
export function validateBlueprint(raw: unknown, source: string): BlueprintResponse {
  const root = expectObject(raw, source, "<root>");

  expectString(root.id, source, "id");
  expectString(root.tenant_id, source, "tenant_id");
  expectString(root.name, source, "name");
  expectString(root.description, source, "description");
  expectString(root.category, source, "category");
  expectArray(root.branches, source, "branches");
  expectArray(root.triggers, source, "triggers");

  const nodes = expectArray(root.nodes, source, "nodes");
  const edges = expectArray(root.edges, source, "edges");
  const forms = expectArray(root.forms, source, "forms");

  // Validate forms first so we can cross-check node.component_id references.
  const formIds = new Set<string>();
  forms.forEach((form, index) => formIds.add(validateForm(form, source, `forms[${index}]`)));

  // Validate nodes second so we can cross-check edge endpoints.
  const nodeIds = new Set<string>();
  nodes.forEach((node, index) => {
    const { id, componentId } = validateNode(node, source, `nodes[${index}]`);
    nodeIds.add(id);
    if (!formIds.has(componentId)) {
      fail(source, `nodes[${index}].data.component_id`, `references unknown form "${componentId}"`);
    }
  });

  edges.forEach((edge, index) => validateEdge(edge, source, `edges[${index}]`, nodeIds));

  return raw as BlueprintResponse;
}

function validateNode(
  raw: unknown,
  src: string,
  path: string,
): { id: string; componentId: string } {
  const node = expectObject(raw, src, path);
  const id = expectString(node.id, src, `${path}.id`);
  if (node.type !== "form") fail(src, `${path}.type`, `expected "form", got ${JSON.stringify(node.type)}`);
  const position = expectObject(node.position, src, `${path}.position`);
  if (typeof position.x !== "number") fail(src, `${path}.position.x`, "expected number");
  if (typeof position.y !== "number") fail(src, `${path}.position.y`, "expected number");

  const data = expectObject(node.data, src, `${path}.data`);
  const componentId = expectString(data.component_id, src, `${path}.data.component_id`);
  expectString(data.id, src, `${path}.data.id`);
  expectString(data.component_key, src, `${path}.data.component_key`);
  expectString(data.name, src, `${path}.data.name`);
  if (data.component_type !== "form") {
    fail(src, `${path}.data.component_type`, `expected "form", got ${JSON.stringify(data.component_type)}`);
  }
  expectArray(data.prerequisites, src, `${path}.data.prerequisites`);
  expectArray(data.permitted_roles, src, `${path}.data.permitted_roles`);
  expectObject(data.input_mapping, src, `${path}.data.input_mapping`);
  const sla = expectObject(data.sla_duration, src, `${path}.data.sla_duration`);
  if (typeof sla.number !== "number") fail(src, `${path}.data.sla_duration.number`, "expected number");
  expectString(sla.unit, src, `${path}.data.sla_duration.unit`);
  expectBool(data.approval_required, src, `${path}.data.approval_required`);
  expectArray(data.approval_roles, src, `${path}.data.approval_roles`);

  return { id, componentId };
}

function validateEdge(raw: unknown, src: string, path: string, nodeIds: Set<string>): void {
  const edge = expectObject(raw, src, path);
  const sourceNodeId = expectString(edge.source, src, `${path}.source`);
  const targetNodeId = expectString(edge.target, src, `${path}.target`);
  if (!nodeIds.has(sourceNodeId)) fail(src, `${path}.source`, `references unknown node "${sourceNodeId}"`);
  if (!nodeIds.has(targetNodeId)) fail(src, `${path}.target`, `references unknown node "${targetNodeId}"`);
}

/** @returns The form id, so the caller can register it in the cross-reference set. */
function validateForm(raw: unknown, src: string, path: string): string {
  const form = expectObject(raw, src, path);
  const id = expectString(form.id, src, `${path}.id`);
  expectString(form.name, src, `${path}.name`);
  expectString(form.description, src, `${path}.description`);
  expectBool(form.is_reusable, src, `${path}.is_reusable`);

  const fieldSchema = expectObject(form.field_schema, src, `${path}.field_schema`);
  if (fieldSchema.type !== "object") {
    fail(src, `${path}.field_schema.type`, `expected "object", got ${JSON.stringify(fieldSchema.type)}`);
  }
  const properties = expectObject(fieldSchema.properties, src, `${path}.field_schema.properties`);
  const required = expectArray(fieldSchema.required, src, `${path}.field_schema.required`);
  required.forEach((entry, index) => expectString(entry, src, `${path}.field_schema.required[${index}]`));

  const propKeys = new Set(Object.keys(properties));
  Object.entries(properties).forEach(([key, prop]) => {
    validateFieldProperty(prop, src, `${path}.field_schema.properties.${key}`);
  });
  // Required fields must actually exist in `properties`.
  required.forEach((entry, index) => {
    if (typeof entry === "string" && !propKeys.has(entry)) {
      fail(src, `${path}.field_schema.required[${index}]`, `references unknown field "${entry}"`);
    }
  });

  validateUiSchema(form.ui_schema, src, `${path}.ui_schema`);

  if (form.dynamic_field_config !== undefined) {
    const dynamicConfig = expectObject(form.dynamic_field_config, src, `${path}.dynamic_field_config`);
    Object.entries(dynamicConfig).forEach(([fieldKey, cfg]) => {
      if (!propKeys.has(fieldKey)) {
        fail(src, `${path}.dynamic_field_config.${fieldKey}`, `references unknown field "${fieldKey}"`);
      }
      validateDynamicFieldConfig(cfg, src, `${path}.dynamic_field_config.${fieldKey}`);
    });
  }

  return id;
}

function validateFieldProperty(raw: unknown, src: string, path: string): void {
  const prop = expectObject(raw, src, path);
  const avantosType = expectString(prop.avantos_type, src, `${path}.avantos_type`);
  if (!AVANTOS_TYPES.has(avantosType as AvantosType)) {
    fail(src, `${path}.avantos_type`, `unknown avantos_type "${avantosType}"`);
  }
  expectString(prop.type, src, `${path}.type`);
  if (prop.title !== undefined) expectString(prop.title, src, `${path}.title`);
  if (prop.format !== undefined) expectString(prop.format, src, `${path}.format`);
}

function validateUiSchema(raw: unknown, src: string, path: string): UiSchema {
  const ui = expectObject(raw, src, path);
  if (typeof ui.type !== "string" || !LAYOUT_TYPES.has(ui.type)) {
    fail(src, `${path}.type`, `expected VerticalLayout|HorizontalLayout, got ${JSON.stringify(ui.type)}`);
  }
  const elements = expectArray(ui.elements, src, `${path}.elements`);
  elements.forEach((element, index) => validateUiElement(element, src, `${path}.elements[${index}]`));
  return ui as unknown as UiSchema;
}

/** Recursive: layouts contain elements, leaves carry a `scope`. */
function validateUiElement(raw: unknown, src: string, path: string): UiSchemaElement {
  const element = expectObject(raw, src, path);
  if (typeof element.type !== "string") fail(src, `${path}.type`, "expected string");
  const elementType = element.type as string;
  if (LAYOUT_TYPES.has(elementType)) {
    const elements = expectArray(element.elements, src, `${path}.elements`);
    elements.forEach((child, index) => validateUiElement(child, src, `${path}.elements[${index}]`));
  } else if (ELEMENT_TYPES.has(elementType)) {
    expectString(element.scope, src, `${path}.scope`);
  } else {
    fail(src, `${path}.type`, `unknown ui_schema element type ${JSON.stringify(elementType)}`);
  }
  return element as unknown as UiSchemaElement;
}

function validateDynamicFieldConfig(raw: unknown, src: string, path: string): DynamicFieldConfig {
  const cfg = expectObject(raw, src, path);
  expectString(cfg.selector_field, src, `${path}.selector_field`);
  expectString(cfg.endpoint_id, src, `${path}.endpoint_id`);
  const payloadFields = expectObject(cfg.payload_fields, src, `${path}.payload_fields`);
  Object.entries(payloadFields).forEach(([payloadKey, payloadValue]) => {
    const field = expectObject(payloadValue, src, `${path}.payload_fields.${payloadKey}`);
    const fieldType = expectString(field.type, src, `${path}.payload_fields.${payloadKey}.type`);
    if (fieldType !== "form_field" && fieldType !== "global") {
      fail(src, `${path}.payload_fields.${payloadKey}.type`, `expected "form_field"|"global", got ${JSON.stringify(fieldType)}`);
    }
    expectString(field.value, src, `${path}.payload_fields.${payloadKey}.value`);
  });
  return cfg as unknown as DynamicFieldConfig;
}
