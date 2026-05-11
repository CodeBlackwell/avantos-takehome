/**
 * @file Endpoint-backed prefill source.
 *
 * The target form's `dynamic_field_config` defines fields whose options
 * come from a remote endpoint. This source surfaces those endpoints as
 * prefill groups so the user can wire any compatible field to one of
 * an endpoint's option items.
 *
 * Today's groups are keyed `(formId × dynamic_field_key × endpointId)` —
 * one group per dynamic field on the target form, even when two fields
 * share an endpoint, so the picker can show distinct context per
 * field. Mappings store all three keys so `resolve()` can locate the
 * right config and refetch.
 */

import type {
  BlueprintForm,
  DynamicFieldConfig,
  FieldKey,
  FormId,
} from "../../api/blueprint";
import {
  fetchEndpoint,
  isEndpointRegistered,
  type EndpointItem,
} from "../../api/endpoints";
import type { Graph } from "../../graph/graph";
import { matchSource } from "../match";
import type {
  Mapping,
  MappingDescription,
  PrefillSource,
  SourceCtx,
  SourceGroup,
  SourceOption,
} from "../types";

/** Stable id persisted inside `Mapping.sourceId`. */
const ID = "endpoint";

/**
 * Separator inside a composite `groupId`. Picked to be a string that
 * cannot appear in any of the three component ids — `formId` /
 * `fieldKey` / `endpointId` are JSON identifiers, never `::`.
 */
const GROUP_ID_SEP = "::";

/**
 * Build a composite `groupId` from `(formId, fieldKey, endpointId)`.
 *
 * Encoding the triple keeps `describe`/`isResolvableIn` self-sufficient
 * — they don't need to scan the graph to recover which dynamic field
 * a mapping belongs to.
 */
const groupId = (formId: FormId, fieldKey: FieldKey, endpointId: string) =>
  `${formId}${GROUP_ID_SEP}${fieldKey}${GROUP_ID_SEP}${endpointId}`;

interface ParsedGroup {
  formId: FormId;
  fieldKey: FieldKey;
  endpointId: string;
}

/**
 * Inverse of {@link groupId}. Returns `null` if the input doesn't have
 * exactly three `::`-separated parts (defensive against persisted
 * mappings from an older encoding).
 */
function parseGroup(raw: string): ParsedGroup | null {
  const parts = raw.split(GROUP_ID_SEP);
  if (parts.length !== 3) return null;
  const [formId, fieldKey, endpointId] = parts as [string, string, string];
  return { formId, fieldKey, endpointId };
}

/** Look up the form definition rendered by the target node. */
function targetForm(graph: Graph, nodeId: string): BlueprintForm | undefined {
  const node = graph.nodeById.get(nodeId);
  if (!node) return undefined;
  return graph.formById.get(node.data.component_id);
}

function configEntries(form: BlueprintForm): [FieldKey, DynamicFieldConfig][] {
  return Object.entries(form.dynamic_field_config ?? {});
}

/**
 * `PrefillSource` that surfaces the target form's
 * `dynamic_field_config` endpoints as picker groups.
 *
 * Each `(formId, fieldKey, endpointId)` triple becomes its own group,
 * so two fields that share an endpoint still get distinct picker
 * sections with the right field-level context.
 */
export const endpointSource: PrefillSource = {
  id: ID,
  label: "Endpoint",
  kind: "endpoint",

  async getGroups(ctx: SourceCtx): Promise<SourceGroup[]> {
    const form = targetForm(ctx.graph, ctx.targetNodeId);
    if (!form) return [];
    const dynamicEntries = configEntries(form);
    if (dynamicEntries.length === 0) return [];

    // Fan out one fetch per dynamic field. Failures are swallowed
    // per-field so a single broken endpoint doesn't blank the picker.
    const groups = await Promise.all(
      dynamicEntries.map(async ([fieldKey, cfg]) => {
        const fieldProp = form.field_schema.properties[fieldKey];
        if (!fieldProp) return null;
        try {
          const { items } = await fetchEndpoint(cfg.endpoint_id);
          const group: SourceGroup = {
            id: groupId(form.id, fieldKey, cfg.endpoint_id),
            label: `${fieldProp.title ?? fieldKey} · ${cfg.endpoint_id.slice(0, 12)}…`,
            options: items.map((item) => {
              // Tag with the dynamic field's `avantos_type` so the
              // compat check gates this option the same way as a
              // direct field-value pick (a `multi-select` endpoint
              // can only fill `multi-select` targets, etc.).
              const opt: SourceOption = {
                id: item.id,
                label: optionLabel(item, cfg.selector_field),
                type: fieldProp.avantos_type,
              };
              if (fieldProp.format !== undefined) opt.format = fieldProp.format;
              return opt;
            }),
          };
          return group;
        } catch {
          // Unknown endpoint id, network error — drop this group rather
          // than reject the whole `Promise.all`.
          return null;
        }
      }),
    );
    return groups.filter((group): group is SourceGroup => group !== null);
  },

  async resolve(mapping: Mapping, _ctx: SourceCtx): Promise<unknown> {
    const parsed = parseGroup(mapping.groupId);
    if (!parsed) return undefined;
    try {
      const { items } = await fetchEndpoint(parsed.endpointId);
      return items.find((item) => item.id === mapping.optionId);
    } catch {
      return undefined;
    }
  },

  describe(mapping: Mapping, graph: Graph): MappingDescription {
    const parsed = parseGroup(mapping.groupId);
    if (!parsed) {
      // Malformed groupId (e.g. persisted from a removed encoding) —
      // fall back to a label that's at least debuggable in the UI.
      return {
        triggerLabel: `Endpoint.${mapping.optionId}`,
        sourceFormName: "Endpoint",
        sourceFieldTitle: mapping.optionId,
      };
    }
    const form = graph.formById.get(parsed.formId);
    const fieldTitle =
      form?.field_schema.properties[parsed.fieldKey]?.title ?? parsed.fieldKey;
    return {
      triggerLabel: `${fieldTitle} (endpoint).${mapping.optionId}`,
      sourceFormName: `${fieldTitle} (endpoint)`,
      sourceFieldTitle: mapping.optionId,
    };
  },

  validateMapping: (raw) => matchSource(raw, ID),

  /**
   * The mapping survives iff:
   *   1. the encoded `groupId` parses,
   *   2. the endpoint is still registered,
   *   3. the target node still renders the same form, AND
   *   4. that form still has `dynamic_field_config` for this field
   *      pointing at the same endpoint.
   *
   * Any of (2)–(4) failing means the wiring is dead and the mapping
   * should be pruned.
   */
  isResolvableIn(mapping: Mapping, ctx: SourceCtx): boolean {
    const parsed = parseGroup(mapping.groupId);
    if (!parsed) return false;
    if (!isEndpointRegistered(parsed.endpointId)) return false;
    const form = targetForm(ctx.graph, ctx.targetNodeId);
    if (!form || form.id !== parsed.formId) return false;
    const cfg = form.dynamic_field_config?.[parsed.fieldKey];
    return !!cfg && cfg.endpoint_id === parsed.endpointId;
  },
};

/**
 * Pick a human label off an endpoint item.
 *
 * Falls through string → number/boolean → item.id so an unusual
 * `selector_field` value never blanks the picker.
 */
function optionLabel(item: EndpointItem, selectorField: string): string {
  const value = item[selectorField];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return item.id;
}
