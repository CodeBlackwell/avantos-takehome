import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldKey, NodeId } from "../api/blueprint";
import type { Graph } from "../graph/graph";
import { pruneDeadMappings } from "../app/prune";
import { validateMapping } from "./registry";
import type { Mapping } from "./types";

/** `mappings[nodeId][fieldKey] = mapping`. The picker's source of truth. */
export type MappingsState = Record<NodeId, Record<FieldKey, Mapping>>;

/** localStorage key for the live mappings store. */
const STORAGE_KEY = "avantos.mappings.v1";
/** localStorage key for the parallel last-seed snapshot (see `seedMappings`). */
const LAST_SEED_KEY = "avantos.mappings.lastSeed.v1";

/**
 * Reactive store for prefill mappings, mirrored to `localStorage`.
 *
 * Returns `{ mappings, setMapping, clearMapping, seedMappings, pruneMappings }`.
 * All setters use functional `setState`, so they don't capture `state`
 * and have stable identities across renders — safe to include in
 * effect dep arrays.
 *
 * Two parallel maps are tracked:
 * - `state`    — what the picker reads / writes; the source of truth.
 * - `lastSeed` — snapshot of the last fixture seed applied. Lets
 *                `seedMappings` distinguish "user untouched, replace
 *                with new seed" from "user-edited, keep their value."
 *                `setMapping` deletes the lastSeed entry so future
 *                seeds never auto-replace a value the user explicitly
 *                chose.
 */
export function useMappings() {
  const [state, setState] = useState<MappingsState>(() => loadState(STORAGE_KEY));
  const [lastSeed, setLastSeed] = useState<MappingsState>(() => loadState(LAST_SEED_KEY));

  // Persist both maps on every change. Cheap (small JSON) and avoids a
  // separate "save" step at component teardown.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    localStorage.setItem(LAST_SEED_KEY, JSON.stringify(lastSeed));
  }, [lastSeed]);

  /** Set or replace one `(nodeId, fieldKey)` mapping. */
  const setMapping = useCallback((nodeId: NodeId, fieldKey: FieldKey, mapping: Mapping) => {
    setState((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], [fieldKey]: mapping } }));
    // User took explicit ownership — future seed reloads must not auto-replace.
    setLastSeed((prev) => removeEntry(prev, nodeId, fieldKey));
  }, []);

  /** Drop one `(nodeId, fieldKey)` mapping. No-op if it wasn't set. */
  const clearMapping = useCallback((nodeId: NodeId, fieldKey: FieldKey) => {
    setState((prev) => removeEntry(prev, nodeId, fieldKey));
    // Don't touch lastSeed: clearing a seeded value should let the next
    // seed pass refill it (matches the documented "re-apply seed after
    // clear" UX).
  }, []);

  /**
   * Apply fixture-supplied defaults.
   *
   * For each `(nodeId, fieldKey)` seed entry:
   * - if no current value: write it.
   * - if current value deep-equals the previous seed: user never
   *   touched it, replace with the new seed (fixes seed-precedence
   *   stickiness when a blueprint's defaults change between loads).
   * - otherwise: user-edited; leave their value alone.
   *
   * The `lastSeed` snapshot is then replaced wholesale so future loads
   * compare against the most recent fixture, not an accumulated history.
   */
  const seedMappings = useCallback((seeds: MappingsState) => {
    setState((prev) => {
      const next: MappingsState = { ...prev };
      for (const [nodeId, seedFields] of Object.entries(seeds)) {
        const existingFields = next[nodeId] ?? {};
        const merged: Record<FieldKey, Mapping> = { ...existingFields };
        for (const [fieldKey, seedMapping] of Object.entries(seedFields)) {
          const currentMapping = existingFields[fieldKey];
          if (!currentMapping) {
            merged[fieldKey] = seedMapping;
            continue;
          }
          const previousSeed = lastSeedRef.current[nodeId]?.[fieldKey];
          // Only replace when the user clearly hasn't edited — i.e. the
          // current value is byte-equal to what we last seeded here.
          if (previousSeed && mappingsEqual(currentMapping, previousSeed)) {
            merged[fieldKey] = seedMapping;
          }
        }
        next[nodeId] = merged;
      }
      return next;
    });
    setLastSeed(seeds);
  }, []);

  /**
   * Drop entries that no longer make sense in `graph` — target node or
   * field removed, source can't resolve, etc. Called on every blueprint
   * load (in `App`) before `seedMappings`, so stale entries from a
   * prior blueprint don't bleed in.
   */
  const pruneMappings = useCallback((graph: Graph) => {
    setState((prev) => pruneDeadMappings(graph, prev));
  }, []);

  // `seedMappings` reads `lastSeed` but mustn't list it as a dep
  // (otherwise the callback identity churns and every consumer rerenders).
  // A ref keeps the callback stable AND lets it see the latest snapshot.
  const lastSeedRef = useLatestRef(lastSeed);

  return { mappings: state, setMapping, clearMapping, seedMappings, pruneMappings };
}

/**
 * Immutable removal: returns a new `MappingsState` with the
 * `(nodeId, fieldKey)` entry deleted, or the input unchanged if the
 * entry doesn't exist.
 */
function removeEntry(state: MappingsState, nodeId: NodeId, fieldKey: FieldKey): MappingsState {
  const fields = state[nodeId];
  if (!fields || !(fieldKey in fields)) return state;
  const nextFields = { ...fields };
  delete nextFields[fieldKey];
  return { ...state, [nodeId]: nextFields };
}

/** Structural equality on `Mapping` (no deep walk needed — three string fields). */
function mappingsEqual(a: Mapping, b: Mapping): boolean {
  return a.sourceId === b.sourceId && a.groupId === b.groupId && a.optionId === b.optionId;
}

/**
 * Restore persisted mappings from `localStorage`. Every entry is run
 * through the registry's `validateMapping`; entries no source claims
 * (e.g. left over from a removed source, or shape-corrupted by a
 * manual localStorage edit) are silently dropped on read.
 *
 * @returns `{}` on any parse error — a corrupted store should not
 *          brick the app.
 */
function loadState(key: string): MappingsState {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const out: MappingsState = {};
    for (const [nodeId, fields] of Object.entries(raw as Record<string, unknown>)) {
      if (!fields || typeof fields !== "object") continue;
      const cleaned: Record<FieldKey, Mapping> = {};
      for (const [fieldKey, candidate] of Object.entries(fields as Record<string, unknown>)) {
        const mapping = validateMapping(candidate);
        if (mapping) cleaned[fieldKey] = mapping;
      }
      if (Object.keys(cleaned).length > 0) out[nodeId] = cleaned;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Mirror `value` into a ref every render. Lets a `useCallback` read the
 * latest value without listing it as a dependency (which would defeat
 * the callback's stable identity).
 *
 * Local helper rather than a util import to keep the module self-contained.
 */
function useLatestRef<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
