/**
 * @file Wire-payload types and fetch helper for the action-blueprint-graph
 * endpoint.
 *
 * Mock server: https://github.com/mosaic-avantos/frontendchallengeserver
 * Endpoint:    `GET /api/v1/:tenantId/actions/blueprints/:blueprintId/graph`
 *
 * Runtime: live HTTP. In dev, `baseUrl` is `""` and Vite proxies `/api` to
 * the mock server on `:3000` (see `src/api/source.ts` and
 * `vite.config.ts`). Tests do not call this — they import
 * `tests/fixtures/graph.json` directly.
 *
 * Frontend-only blueprints (see `./localBlueprints.ts`) short-circuit the
 * network entirely; everything in this file is shaped to be a one-line
 * swap to a real backend.
 */

/** Canvas instance id. e.g. `"form-<uuid>"`. */
export type NodeId = string;
/** Form definition id. e.g. `"f_..."`. */
export type FormId = string;
/** Property key inside `field_schema.properties`. */
export type FieldKey = string;

/**
 * Closed set of value-type tags emitted by the blueprint server.
 *
 * The picker uses these to gate compatible source options against the
 * target field via `isCompatible` (today: strict equality).
 */
export type AvantosType =
  | "button"
  | "checkbox-group"
  | "multi-line-text"
  | "multi-select"
  | "object-enum"
  | "short-text";

/** A single property inside `BlueprintForm.field_schema.properties`. */
export interface FieldSchemaProperty {
  /** Value-type tag — drives compat checks and TypeBadge color. */
  avantos_type: AvantosType;
  /** JSON Schema `type` (`"string"`, `"array"`, …). Not used for compat. */
  type: string;
  /** Human label shown in the UI; falls back to the field key. */
  title?: string;
  /** Optional sub-format hint (e.g. `"email"`, `"date-time"`). */
  format?: string;
  /** Closed value set, when the field is an enum. */
  enum?: unknown[] | null;
  /** Item shape, when the field is an array. */
  items?: { type: string; enum?: unknown[] };
  /** When the field is an array, whether duplicates are allowed. */
  uniqueItems?: boolean;
}

/**
 * JsonForms-style `ui_schema` element.
 *
 * Today's fixtures only nest `VerticalLayout` containers with flat
 * `Control`/`Button` leaves, but the type is recursive so future
 * fixtures can interleave layouts without a type change.
 */
export type UiSchemaElement =
  | { type: "VerticalLayout" | "HorizontalLayout"; elements: UiSchemaElement[] }
  | {
      type: "Control" | "Button";
      /** `"#/properties/<fieldKey>"` — references one field by key. */
      scope: string;
      label?: string;
      options?: { format?: string };
    };

/** Top-level layout node of a form's `ui_schema`. */
export interface UiSchema {
  type: "VerticalLayout" | "HorizontalLayout";
  elements: UiSchemaElement[];
}

/**
 * Per-field config for fields whose option list comes from a remote
 * endpoint.
 *
 * The field's options are fetched at runtime; `payload_fields` names
 * what to send in the request, sourced from another field on the same
 * form (`form_field`) or from global data (`global`).
 */
export interface DynamicPayloadField {
  type: "form_field" | "global";
  value: string;
}

export interface DynamicFieldConfig {
  /** Property of each returned item to surface as the option label. */
  selector_field: string;
  /** Request payload, keyed by request field name. */
  payload_fields: Record<string, DynamicPayloadField>;
  /** Endpoint id (resolved against `src/api/endpoints/*.json`). */
  endpoint_id: string;
}

/** Form definition referenced by one or more nodes via `data.component_id`. */
export interface BlueprintForm {
  id: FormId;
  name: string;
  description: string;
  /** When true, multiple nodes can render this form (see `nodesByFormId`). */
  is_reusable: boolean;
  field_schema: {
    type: "object";
    properties: Record<FieldKey, FieldSchemaProperty>;
    required: FieldKey[];
  };
  ui_schema: UiSchema;
  /** Empty in fixtures with no dynamic fields. Keys are `FieldKey`s. */
  dynamic_field_config?: Record<FieldKey, DynamicFieldConfig>;
}

export interface BlueprintNodeData {
  id: string;
  /** References `BlueprintForm.id` — the form this node renders. */
  component_id: FormId;
  component_key: string;
  component_type: "form";
  name: string;
  /**
   * Denormalized parent ids. Ignored for traversal — `edges[]` is the
   * canonical source (CLAUDE.md hard rule 8).
   */
  prerequisites: NodeId[];
  permitted_roles: string[];
  /** Fixture-supplied default mappings. Keyed by `FieldKey`. */
  input_mapping: Record<string, unknown>;
  sla_duration: { number: number; unit: string };
  approval_required: boolean;
  approval_roles: string[];
}

export interface BlueprintNode {
  id: NodeId;
  type: "form";
  position: { x: number; y: number };
  data: BlueprintNodeData;
}

export interface BlueprintEdge {
  source: NodeId;
  target: NodeId;
}

/** Top-level wire payload returned by the blueprint endpoint. */
export interface BlueprintResponse {
  $schema?: string;
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  category: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  forms: BlueprintForm[];
  /** Reserved by the backend. Empty in current fixtures. */
  branches: unknown[];
  /** Reserved by the backend. Empty in current fixtures. */
  triggers: unknown[];
}

/**
 * Per-`(baseUrl, tenant, blueprint)` cache of in-flight or resolved
 * blueprint promises.
 *
 * Keyed by the full triple so tests with different bases don't collide.
 * Caching the *Promise* (not the resolved value) means concurrent
 * re-clicks dedupe to a single network request; rejected fetches are
 * evicted in `fetchBlueprint`'s `.catch` so the next attempt actually
 * retries instead of replaying the failure.
 */
const blueprintCache = new Map<string, Promise<BlueprintResponse>>();

/**
 * Fetch a blueprint payload by id.
 *
 * Local-catalog ids short-circuit the network (see
 * `./localBlueprints.ts`); everything else hits
 * `/api/v1/:tenant/actions/blueprints/:id/graph`.
 *
 * Results are cached by `(baseUrl, tenantId, blueprintId)`. Concurrent
 * calls dedupe to a single in-flight Promise; rejected fetches are
 * evicted so a retry re-hits the network.
 *
 * @throws If the HTTP response is non-2xx (only on the live-network path).
 */
export async function fetchBlueprint(
  baseUrl: string,
  tenantId: string,
  blueprintId: string,
): Promise<BlueprintResponse> {
  const cacheKey = `${baseUrl}|${tenantId}|${blueprintId}`;
  const cached = blueprintCache.get(cacheKey);
  if (cached) return cached;

  // Frontend-only blueprints (see ./localBlueprints.ts) short-circuit the
  // network. Lazy import keeps blueprint.ts decoupled from the catalog —
  // tests can stub `localBlueprints` without dragging in this file.
  const localPayload = await import("./localBlueprints").then((mod) =>
    mod.getLocalBlueprint(blueprintId),
  );
  if (localPayload) {
    const resolved = Promise.resolve(localPayload);
    blueprintCache.set(cacheKey, resolved);
    return resolved;
  }

  const url = `${baseUrl}/api/v1/${tenantId}/actions/blueprints/${blueprintId}/graph`;
  const inFlight = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetchBlueprint ${res.status} ${res.statusText}`);
    return res.json() as Promise<BlueprintResponse>;
  })();
  blueprintCache.set(cacheKey, inFlight);
  // Evict on failure so the next call actually retries — caching a rejected
  // Promise would replay the same error forever.
  inFlight.catch(() => blueprintCache.delete(cacheKey));
  return inFlight;
}

/**
 * Seed the cache with a response we already have in hand.
 *
 * Used by the catalog probe in `source.ts`: the probe URL uses a
 * placeholder id (the server's regex matches but ignores it), and the
 * response carries the real `id`. Priming the cache under that real id
 * makes the next `fetchBlueprint(realId)` a hit instead of a duplicate
 * round-trip.
 */
export function primeBlueprintCache(
  baseUrl: string,
  tenantId: string,
  blueprintId: string,
  response: BlueprintResponse,
): void {
  blueprintCache.set(`${baseUrl}|${tenantId}|${blueprintId}`, Promise.resolve(response));
}

/** Drop every cached blueprint. Test-only. */
export function clearBlueprintCache(): void {
  blueprintCache.clear();
}
