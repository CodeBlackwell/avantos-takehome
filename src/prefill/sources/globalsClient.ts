/// <reference types="vite/client" />
/**
 * @file Faked transport for global prefill data (currentUser, clientOrg, …).
 *
 * Each global is a JSON file under `../globals/`, shape
 * `{ label, fields }`. Vite's `import.meta.glob` discovers them at
 * build time — drop a new `<globalId>.json` in that directory and
 * it's surfaced through the picker automatically. Swapping in a real
 * backend is a one-file change: replace the static `FIXTURE` with a
 * `fetch()`.
 *
 * **Two read paths intentionally exist** because `PrefillSource` mixes
 * async (`getGroups`, `resolve`) and sync (`describe`,
 * `isResolvableIn`) methods:
 *   - {@link loadGlobals}     — async path. Awaited from `getGroups`/`resolve`.
 *   - {@link getGlobalsCached} — sync read for `describe`/`isResolvableIn`,
 *     which the contract requires to be synchronous. `App` boots by
 *     awaiting `loadGlobals()` once before the first blueprint fetch,
 *     so the cache is populated before anything that calls the sync
 *     path.
 *
 * Making the sync methods async would ripple through prune and the
 * picker for no win — instead we guarantee load-before-use at the
 * App boundary.
 */

import type { AvantosType } from "../../api/blueprint";

/** One global field's value + type tag (matches `FieldSchemaProperty`'s slice). */
export interface GlobalField {
  value: unknown;
  type: AvantosType;
}

/** `globalsData[groupId][fieldKey] = { value, type }`. */
export type GlobalsData = Record<string, Record<string, GlobalField>>;

/** On-disk shape of `../globals/<id>.json`. */
interface GlobalFile {
  label: string;
  fields: Record<string, GlobalField>;
}

const globalModules = import.meta.glob<GlobalFile>("../globals/*.json", {
  eager: true,
  import: "default",
});

/** Internal store. Populated at module init from JSON files. */
const FIXTURE: GlobalsData = {};
/** Display labels per group, keyed by `groupId`. */
export const GLOBAL_LABELS: Record<string, string> = {};
for (const [modulePath, file] of Object.entries(globalModules)) {
  const groupId = modulePath.match(/\/([^/]+)\.json$/)?.[1];
  if (!groupId) throw new Error(`Unrecognized globals filename: ${modulePath}`);
  FIXTURE[groupId] = file.fields;
  GLOBAL_LABELS[groupId] = file.label;
}

/** Resolved value once `loadGlobals()` has settled. */
let globalsCache: GlobalsData | null = null;
/** In-flight promise so concurrent callers share one request. */
let globalsInFlight: Promise<GlobalsData> | null = null;

/**
 * Async load of the globals payload.
 *
 * Cached after first resolve; concurrent callers share the in-flight
 * Promise. `App.tsx` awaits this once at boot so the sync path
 * ({@link getGlobalsCached}) is primed before the picker renders.
 */
export function loadGlobals(): Promise<GlobalsData> {
  if (globalsCache) return Promise.resolve(globalsCache);
  if (globalsInFlight) return globalsInFlight;
  globalsInFlight = Promise.resolve(FIXTURE).then((data) => {
    globalsCache = data;
    globalsInFlight = null;
    return data;
  });
  return globalsInFlight;
}

/**
 * Sync read of the cached globals, or `{}` if `loadGlobals()` hasn't
 * resolved yet.
 *
 * The empty default is the safe answer for `describe` and
 * `isResolvableIn`: an unknown global gets treated as "no such option,"
 * which yields a graceful prune rather than a thrown error. In
 * practice `App` awaits `loadGlobals()` before either method runs.
 */
export function getGlobalsCached(): GlobalsData {
  return globalsCache ?? {};
}

/** Drop the cached globals payload. Test-only. */
export function clearGlobalsCache(): void {
  globalsCache = null;
  globalsInFlight = null;
}
