import type { Graph } from "../../graph/graph";
import { matchSource } from "../match";
import type { Mapping, MappingDescription, PrefillSource, SourceCtx, SourceGroup } from "../types";
import { GLOBAL_LABELS, getGlobalsCached, loadGlobals } from "./globalsClient";

/** Stable id persisted inside `Mapping.sourceId`. Never rename without a migration. */
const ID = "global";

/**
 * Project the loaded globals payload into picker-shaped groups. One
 * `SourceGroup` per top-level key (`currentUser`, `clientOrg`, …).
 */
function buildGroups(data: ReturnType<typeof getGlobalsCached>): SourceGroup[] {
  return Object.entries(data).map(([groupId, fields]) => ({
    id: groupId,
    label: GLOBAL_LABELS[groupId] ?? groupId,
    options: Object.entries(fields).map(([key, field]) => ({
      id: key,
      label: key,
      type: field.type,
    })),
  }));
}

/**
 * `PrefillSource` for global data (`currentUser`, `clientOrg`, …).
 *
 * Async on read paths (`getGroups`/`resolve`) so a future
 * `fetch()`-backed loader drops in without touching this file; sync on
 * inspection paths (`describe`/`isResolvableIn`) per the contract.
 *
 * Mapping shape: `groupId` is the global namespace (e.g. `"currentUser"`),
 * `optionId` is the field key within that namespace (e.g. `"email"`).
 */
export const globalDataSource: PrefillSource = {
  id: ID,
  label: "Global data",
  kind: "global",

  async getGroups(_ctx: SourceCtx): Promise<SourceGroup[]> {
    const data = await loadGlobals();
    return buildGroups(data);
  },

  async resolve(mapping: Mapping, _ctx: SourceCtx): Promise<unknown> {
    const data = await loadGlobals();
    return data[mapping.groupId]?.[mapping.optionId]?.value;
  },

  describe(mapping: Mapping, _graph: Graph): MappingDescription {
    const groupLabel = GLOBAL_LABELS[mapping.groupId] ?? mapping.groupId;
    return {
      triggerLabel: `${groupLabel}.${mapping.optionId}`,
      sourceFormName: groupLabel,
      sourceFieldTitle: mapping.optionId,
    };
  },

  validateMapping: (raw) => matchSource(raw, ID),

  /**
   * The mapping survives iff the referenced global namespace AND its
   * field key still exist in the cached payload. Reads sync from the
   * cache (primed at App boot — see `globalsClient`).
   */
  isResolvableIn(mapping: Mapping, _ctx: SourceCtx): boolean {
    const data = getGlobalsCached();
    const group = data[mapping.groupId];
    return !!group && Object.prototype.hasOwnProperty.call(group, mapping.optionId);
  },
};
