/**
 * @file The single load-bearing abstraction for the picker.
 *
 * Adding a new prefill source is one new file (under `./sources/`) plus
 * one line in `./registry.ts`. If a new source forces a change to
 * anything else, the abstraction is wrong — fix the abstraction,
 * don't paper over it (CLAUDE.md hard rule 6).
 */

import type { AvantosType, FieldKey, NodeId } from "../api/blueprint";
import type { Graph } from "../graph/graph";

/**
 * A single pickable value within a {@link SourceGroup}.
 *
 * `type` is the option's `avantos_type`; the picker uses it to gate
 * compatibility against the target field. `format` is an optional
 * sub-format hint shown in the badge (e.g. `"email"`).
 */
export type SourceOption = { id: string; label: string; type: AvantosType; format?: string };

/**
 * One section in the picker. For graph sources, `id` is the upstream
 * `NodeId`. For globals, it's a key in the source's own keyspace.
 */
export type SourceGroup = { id: string; label: string; options: SourceOption[] };

/**
 * Persisted reference to one option from one group of one source.
 *
 * Open shape on purpose — the discriminant is `sourceId`, and each
 * `PrefillSource` owns its own `validateMapping`. Adding a source
 * never forces an edit to this file (see CLAUDE.md rule 7).
 */
export interface Mapping {
  /** Stable id of the owning source; matches `PrefillSource.id`. */
  sourceId: string;
  /** Group id within the source's `getGroups` output. */
  groupId: string;
  /** Option id within the chosen group. */
  optionId: string;
}

/**
 * Ambient context handed to every `PrefillSource` method that touches
 * the current target.
 */
export interface SourceCtx {
  /** Node whose field is being filled. */
  targetNodeId: NodeId;
  /** Indexed view of the loaded blueprint. */
  graph: Graph;
  /**
   * Optional per-node form submissions, keyed `[nodeId][fieldKey]`.
   * Currently only `formFieldsSource.resolve` reads this.
   */
  submissions?: Record<NodeId, Record<FieldKey, unknown>>;
}

/**
 * Two display projections of one mapping.
 *
 * - `triggerLabel` is the inline label on a field row (`"Form B.Email"`).
 * - `sourceFormName` + `sourceFieldTitle` feed the graph node tile and tooltip.
 */
export interface MappingDescription {
  triggerLabel: string;
  sourceFormName: string;
  sourceFieldTitle: string;
}

/**
 * The single load-bearing abstraction.
 *
 * Add a new source: create one file under `./sources/` exporting a
 * `PrefillSource`, append it to `registry.sources`. Nothing else in the
 * codebase needs to change.
 *
 * **Implementation checklist for new sources:**
 *   - `id`              — stable string, never re-used; persisted inside `Mapping.sourceId`.
 *   - `label`           — section header shown in the picker (user-visible).
 *   - `kind`            — `"graph"` if groups are `NodeId`s, `"global"` otherwise, `"endpoint"` for endpoint-backed.
 *   - `getGroups`       — discovery: what's pickable right now? May be async.
 *   - `resolve`         — evaluation: what value does this mapping produce at runtime?
 *   - `describe`        — display projection: chip text + tooltip strings.
 *   - `validateMapping` — shape claim: use `matchSource(raw, ID)` from `./match`.
 *   - `isResolvableIn`  — prune check: is the referenced thing still here?
 *
 * See `sources/globalDataSource.ts` for the smallest reference implementation.
 */
export interface PrefillSource {
  /** Stable, never-reused id. Persisted inside `Mapping.sourceId`. */
  id: string;
  /** Section header shown in the picker (user-visible). */
  label: string;
  /**
   * Picker grouping + prune semantics:
   * - `"graph"`    — groups whose ids are `NodeId`s (forms in the DAG).
   * - `"global"`   — groups in the source's own keyspace (ids unrelated to nodes).
   * - `"endpoint"` — groups tied to `dynamic_field_config` endpoints on the target form.
   */
  kind: "graph" | "global" | "endpoint";
  /** Discovery — what's pickable right now? May be sync or async. */
  getGroups(ctx: SourceCtx): SourceGroup[] | Promise<SourceGroup[]>;
  /** Evaluation — what value does this mapping produce at runtime? May be sync or async. */
  resolve(mapping: Mapping, ctx: SourceCtx): unknown | Promise<unknown>;
  /**
   * Display projection. Takes `Graph` (not `SourceCtx`) because trigger
   * labels and tooltip strings don't need a target node — they're a
   * property of the mapping alone. Keeps callers from fabricating a
   * fake `targetNodeId`.
   */
  describe(mapping: Mapping, graph: Graph): MappingDescription;
  /**
   * Returns `mapping` re-typed if `raw` belongs to this source AND is
   * shaped correctly, otherwise `null`. Used by `useMappings` on load
   * and by `App` when seeding from fixtures.
   */
  validateMapping(raw: unknown): Mapping | null;
  /**
   * True iff this mapping is currently resolvable against `ctx`
   * (referenced group/option/ancestor still exists). Drives
   * prune-on-blueprint-load so stale mappings from a prior blueprint
   * don't bleed into the current one.
   */
  isResolvableIn(mapping: Mapping, ctx: SourceCtx): boolean;
}
