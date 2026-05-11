/**
 * @file Single source-of-truth for *where* blueprint data comes from.
 *
 * - **Dev:** HTTP via Vite's `/api` proxy (`vite.config.ts`) →
 *   `frontendchallengeserver` on `localhost:3000` → returns `graph.json`
 *   (the upstream's only fixture; `:blueprintId` in the URL is matched
 *   but ignored).
 * - **Tests:** bypass this module entirely. Specs import
 *   `tests/fixtures/graph.json` directly so they don't need the mock
 *   server running.
 *
 * Catalog (the list of available blueprints) is the union of the live
 * server's single fixture and every JSON file under `./blueprints/`,
 * color-coded in the selector.
 */

import {
  primeBlueprintCache,
  type BlueprintResponse,
} from "./blueprint";
import { LOCAL_BLUEPRINT_IDS, getLocalBlueprint } from "./localBlueprints";
import type { BlueprintOption } from "../components/BlueprintSelector";

/** Empty base = same-origin. Vite rewrites `/api` to `http://localhost:3000` in dev. */
export const API_PROXY_BASE = "";

/** Matched but ignored by the mock server's route regex. */
export const TENANT_ID = "tenant-1";

/**
 * Placeholder URL segment for the catalog probe. The mock server ignores
 * `:blueprintId`, so the value is cosmetic — we discover the real id
 * from the response payload.
 */
const PROBE_BLUEPRINT_ID = "_";

/** Resolved catalog. Populated after the first successful `fetchBlueprintList()`. */
let catalogCache: BlueprintOption[] | null = null;
/** In-flight catalog request. Lets concurrent callers share one fetch. */
let catalogInFlight: Promise<BlueprintOption[]> | null = null;

/**
 * Build the merged blueprint catalog (server probe + local fixtures).
 *
 * The mock server has no list endpoint, so we probe
 * `/blueprints/_/graph` once with a placeholder id and use whatever
 * payload comes back as the single "server" option. Local blueprints are
 * read synchronously from `localBlueprints` (they were eagerly loaded at
 * module init by `import.meta.glob`).
 *
 * Server response is also primed into `fetchBlueprint`'s per-id cache so
 * the user's first click is a hit, not a duplicate request.
 *
 * Result is cached for the session; tests can reset via
 * {@link clearBlueprintListCache}.
 */
export function fetchBlueprintList(): Promise<BlueprintOption[]> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (catalogInFlight) return catalogInFlight;

  // Server-side probe. Wrapped in try/catch because the mock server may
  // be down — a failed bootstrap shouldn't block the selector; the user
  // can still pick a local blueprint.
  const serverOptions = (async (): Promise<BlueprintOption[]> => {
    try {
      const url = `${API_PROXY_BASE}/api/v1/${TENANT_ID}/actions/blueprints/${PROBE_BLUEPRINT_ID}/graph`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const payload = (await res.json()) as BlueprintResponse;
      // Prime the per-id cache under the discovered real id so the next
      // click on this row hits cache instead of issuing a second request.
      primeBlueprintCache(API_PROXY_BASE, TENANT_ID, payload.id, payload);
      return [{
        id: payload.id,
        label: payload.name,
        source: "server",
        description: payload.description,
        category: payload.category,
      }];
    } catch {
      return [];
    }
  })();

  // Local-side: synchronous read (modules already loaded). `flatMap` lets
  // us skip ids whose fixture failed to validate without nesting filter+map.
  const localOptions: BlueprintOption[] = LOCAL_BLUEPRINT_IDS.flatMap((blueprintId) => {
    const payload = getLocalBlueprint(blueprintId);
    if (!payload) return [];
    return [{
      id: blueprintId,
      label: payload.name,
      source: "local" as const,
      description: payload.description,
      category: payload.category,
    }];
  });

  catalogInFlight = serverOptions.then((server) => {
    const merged = [...server, ...localOptions];
    catalogCache = merged;
    catalogInFlight = null;
    return merged;
  });
  return catalogInFlight;
}

/** Drop the cached blueprint catalog. Test-only. */
export function clearBlueprintListCache(): void {
  catalogCache = null;
  catalogInFlight = null;
}
