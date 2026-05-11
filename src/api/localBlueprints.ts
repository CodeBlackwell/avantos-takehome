/// <reference types="vite/client" />
/**
 * @file Frontend-only blueprint catalog.
 *
 * The mock server cannot be modified (graders run upstream as shipped —
 * see CLAUDE.md hard rule 9), so any scenario beyond the upstream's
 * single `graph.json` lives here as a JSON file under `./blueprints/`.
 *
 * **Catalog is auto-discovered.** Every `graph.<id>.json` under
 * `./blueprints/` is picked up by Vite's `import.meta.glob` at build
 * time and run through {@link validateBlueprint}. Drop a new JSON file
 * in the directory and it shows up in the selector — no edits needed
 * here. The blueprint id is parsed from the filename; the selector
 * label comes from the payload's `name` field (see `source.ts`).
 */

import type { BlueprintResponse } from "./blueprint";
import { validateBlueprint } from "./validateBlueprint";

/** Eager glob: every blueprint JSON inlined as a default-export module. */
const blueprintModules = import.meta.glob<unknown>("./blueprints/graph.*.json", {
  eager: true,
  import: "default",
});

/**
 * Parsed catalog as `[id, payload]` pairs.
 *
 * `validateBlueprint` is the load-bearing shape check: every JSON file
 * is walked at module init so any drift (typo'd `avantos_type`,
 * dangling `component_id`, edge to a non-existent node) throws
 * immediately at app boot with a clean path-and-source error rather
 * than producing mystery undefined-traversal bugs deep in the picker.
 *
 * Catalog order is alphabetical by filename, which drives selector
 * button order.
 */
const catalogEntries: Array<[string, BlueprintResponse]> = Object.entries(blueprintModules).map(
  ([modulePath, rawPayload]) => {
    const blueprintId = modulePath.match(/graph\.(.+)\.json$/)?.[1];
    if (!blueprintId) throw new Error(`Unrecognized blueprint filename: ${modulePath}`);
    return [blueprintId, validateBlueprint(rawPayload, blueprintId)];
  },
);
catalogEntries.sort((a, b) => a[0].localeCompare(b[0]));

const CATALOG: Record<string, BlueprintResponse> = Object.fromEntries(catalogEntries);

/** All blueprint ids known to the local catalog, in alphabetical (filename) order. */
export const LOCAL_BLUEPRINT_IDS = Object.keys(CATALOG);

/**
 * True if `blueprintId` is served by the local catalog (no network needed).
 *
 * Use `Object.prototype.hasOwnProperty` rather than `in` to avoid
 * matching inherited properties from `Object.prototype`.
 */
export function isLocalBlueprint(blueprintId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOG, blueprintId);
}

/** Look up a local blueprint payload by id, or `undefined` if not in the catalog. */
export function getLocalBlueprint(blueprintId: string): BlueprintResponse | undefined {
  return CATALOG[blueprintId];
}
