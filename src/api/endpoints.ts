/// <reference types="vite/client" />
/**
 * @file Faked transport for `dynamic_field_config` endpoints.
 *
 * Endpoint payloads are JSON files under `./endpoints/`, one per
 * `endpoint_id` (filename matches the id). Vite's `import.meta.glob`
 * discovers them at build time — drop a new `<endpoint_id>.json` in
 * that directory and it's available here automatically.
 *
 * Swapping in a real backend is a one-file change: replace the
 * `FIXTURE` lookup with `fetch(...)`.
 *
 * Each endpoint returns an array of option items. The form's
 * `selector_field` names which property of each item to use as the
 * label (e.g. `"title"`); the item's `id` is its stable key.
 */

/** One option returned by an endpoint. `id` is required; everything else is shape-on-demand. */
export interface EndpointItem {
  id: string;
  [key: string]: unknown;
}

/** Wire shape returned by `fetchEndpoint`. */
export interface EndpointResponse {
  items: EndpointItem[];
}

const endpointModules = import.meta.glob<EndpointResponse>("./endpoints/*.json", {
  eager: true,
  import: "default",
});

/** `endpoint_id → items[]` map built once at module init. */
const FIXTURE: Record<string, EndpointItem[]> = Object.fromEntries(
  Object.entries(endpointModules).map(([modulePath, payload]) => {
    const endpointId = modulePath.match(/\/([^/]+)\.json$/)?.[1];
    if (!endpointId) throw new Error(`Unrecognized endpoint filename: ${modulePath}`);
    return [endpointId, payload.items];
  }),
);

/** Per-id Promise cache. Same dedupe pattern as `blueprintCache`. */
const endpointCache = new Map<string, Promise<EndpointResponse>>();

/**
 * Fetch the option list for a `dynamic_field_config` endpoint.
 *
 * Cached per id (concurrent callers share one Promise). Rejects if
 * `endpointId` has no fixture; swap the `FIXTURE` lookup for a real
 * `fetch()` to point at a backend.
 *
 * Returns a shallow copy of the items array so callers can mutate it
 * (sort, slice) without poisoning the cache.
 */
export function fetchEndpoint(endpointId: string): Promise<EndpointResponse> {
  const cached = endpointCache.get(endpointId);
  if (cached) return cached;
  const items = FIXTURE[endpointId];
  if (!items) {
    return Promise.reject(new Error(`fetchEndpoint: unknown endpoint ${endpointId}`));
  }
  const promise = Promise.resolve({ items: items.slice() });
  endpointCache.set(endpointId, promise);
  return promise;
}

/** True if a fixture exists for `endpointId`. Read by `endpointSource.isResolvableIn`. */
export function isEndpointRegistered(endpointId: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIXTURE, endpointId);
}

/** Drop every cached endpoint response. Test-only. */
export function clearEndpointCache(): void {
  endpointCache.clear();
}
