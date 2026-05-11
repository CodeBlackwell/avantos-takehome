# CLAUDE.md — Avantos Journey Builder

Guidance for any agent (including Claude) working in this repo. Read before editing.

## What this is

A React/TS app that fetches a DAG of forms from a mock backend and lets the
user wire each field's prefill mapping to a value drawn from a pluggable set
of data sources: upstream form fields (direct or transitive), shared global
data (`currentUser`, `clientOrg`), and `dynamic_field_config` endpoints
declared on the target form.

The single load-bearing design choice is the `PrefillSource` interface in
`src/prefill/types.ts`. Everything else is mechanical.

## The PrefillSource contract

```ts
export interface PrefillSource {
  id: string;                                       // stable; persisted inside Mapping
  label: string;                                    // section header in picker
  kind: "graph" | "global" | "endpoint";            // picker grouping + prune semantics
  getGroups(ctx): SourceGroup[] | Promise<...>;     // discovery
  resolve(mapping, ctx): unknown   | Promise<...>;  // evaluation
  describe(mapping, graph): MappingDescription;     // display projection
  validateMapping(raw: unknown): Mapping | null;    // shape claim/reject
  isResolvableIn(mapping, ctx): boolean;            // prune-time check
}
```

Five methods, five concerns: discovery, evaluation, display, shape
validation, resolvability. Anything less is a hollow shell — callers
end up reaching back into the source's keyspace with `switch` statements.

**Adding a source is one new file under `src/prefill/sources/` plus one line in
`src/prefill/registry.ts`.** If a change to anything else is required, the
abstraction is wrong; fix the abstraction, don't paper over it.

## Hard rules

1. **No state library.** `useState` + `useEffect` is enough. No Zustand,
   Redux, Jotai, or Context-with-reducer.
2. **No graph library.** Traversal is ~10 lines of pure TS in `src/graph/graph.ts`.
   ELK is used only for SVG layout in `GraphView.tsx`, not for traversal.
3. **UI kit: shadcn/ui + Tailwind v4.** Primitives under `src/components/ui/`
   are owned and editable; import via the `@/` alias.
4. **Sources return data, never JSX.** Rendering belongs to the picker.
5. **`getGroups`/`resolve` are typed `T | Promise<T>`.** Always `await` at
   the call site; sync sources just `return`.
6. **Picker option rows are never hidden.** Type-incompatible options stay
   visible but disabled, with their `avantos_type` shown alongside, so the
   user sees *why* a row is blocked. Compatibility is strict equality on
   `avantos_type` today (`src/prefill/compat.ts`); loosening is a UX call.
7. **Target fields are filtered to value-bearing types.** `avantos_type === "button"`
   is dropped at the target-side call site in `FormList.tsx` — not inside
   `getFieldOrder`, because source-side enumeration still needs every field
   so the disabled-but-visible option rows stay intact. Source-side
   transparency and target-side relevance are separate axes.
8. **`edges[]` is the canonical parent source.** `node.data.prerequisites` is
   a denormalization that may drift; ignore it for traversal. The parent
   index is built from `edges` once in `buildGraph`.
9. **The upstream mock server is immutable.** Graders run
   `mosaic-avantos/frontendchallengeserver` as shipped — never modify
   the server, its fixtures, or its route. New scenarios live in
   `src/api/blueprints/*.json` (auto-discovered local catalog) or in
   the faked endpoints/globals under `src/api/endpoints/` and
   `src/prefill/globals/`.

## Fetch pattern

Four pieces of data are loaded (one real, three faked in-frontend). Every
call site awaits, so swapping a fake for a real `fetch()` is a one-file change.

1. **Blueprint payload** — `fetchBlueprint(base, tenant, id)` in
   `src/api/blueprint.ts`. Live HTTP via Vite's `/api` proxy in dev. Cached
   by `(base, tenant, id)`; in-flight Promises are shared so concurrent
   re-clicks dedupe; rejected fetches are evicted so retries re-hit the
   network. Local-catalog ids short-circuit the network entirely.
2. **Blueprint catalog** — `fetchBlueprintList()` in `src/api/source.ts`.
   Server probe + local fixtures merged, color-coded by source. The probe
   primes `fetchBlueprint`'s per-id cache as a side effect.
3. **Endpoint registry (`dynamic_field_config`)** — `fetchEndpoint(id)` in
   `src/api/endpoints.ts`. Returns canned `{ items: [...] }` per endpoint;
   payloads are JSON files under `src/api/endpoints/` and auto-discovered
   by `import.meta.glob`.
4. **Global data** — `loadGlobals()` in `src/prefill/sources/globalsClient.ts`.
   Globals are JSON files under `src/prefill/globals/`, same auto-discovery.

### Async/sync split for globals

The `PrefillSource` contract mixes async (`getGroups`, `resolve`) and sync
(`describe`, `isResolvableIn`) methods. Making the sync ones async would
ripple through prune and the picker for no win. Instead, `globalsClient`
exposes two read paths:

- `loadGlobals()` — async, awaited by `getGroups`/`resolve`.
- `getGlobalsCached()` — sync read for the inspection methods.

`App.tsx` awaits `loadGlobals()` before the first blueprint fetch, so the
sync cache is primed before anything that reads it.

## Sharing across reusable forms

When `form.is_reusable` is true, multiple nodes can render the same form
definition (`component_id`). **Only global-source mappings are shared across
those instances.** Graph-source mappings stay per-node because resolvability
depends on each instance's ancestor set; endpoint mappings stay per-node
because every instance derives the same endpoint group anyway.

The fan-out lives in one helper: `nodesSharing(graph, nodeId, mapping)` in
`src/app/sharing.ts`. Used at three sites: `App.tsx onCommit`, `App.tsx onClear`,
and `extractSeeds`. Storage stays simple — `(NodeId, FieldKey)` keys
throughout; siblings just hold the same value.

## Mapping bleed across blueprints

Switching blueprints could leak persisted mappings from a prior blueprint
into the next one. Two mechanisms prevent this:

1. **Prune on load.** `App` calls `pruneMappings(graph)` after every blueprint
   fetch, before `seedMappings`. `pruneDeadMappings` (in `src/app/prune.ts`)
   drops entries whose target node/field is gone or whose
   `source.isResolvableIn(mapping, ctx)` returns false.
2. **Last-seed tracking.** `useMappings` keeps a parallel `lastSeed` snapshot.
   `seedMappings` replaces values that deep-equal the previous seed (user
   untouched) and leaves values that diverge (user-edited). `setMapping`
   deletes the lastSeed entry so future seed loads never auto-replace a
   value the user explicitly chose.

## File layout (high level)

```
src/
  api/          Blueprint + endpoint fetch helpers; local catalog auto-discovery; runtime shape validation
  graph/        buildGraph, getAncestors, topoIndex, reusable-form reverse index
  prefill/      PrefillSource contract, registry, source implementations, mappings hook
  app/          Pure helpers used by App.tsx: seeds, prune, sharing, tree order, deps
  components/   AppShell, BlueprintSelector, SortControl, FormList, FormFields, FieldPicker, GraphView
  components/ui/ shadcn primitives (owned)
  lib/utils.ts  cn() — tailwind-merge + clsx
  App.tsx, main.tsx
tests/          Unit tests for pure modules + one integration test for the picker flow
```

Every module under `src/` has a file-level `@file` header and JSDoc on its
exports; consult those for per-file detail.

## Working in the repo

- Run `npm run typecheck` and `npm test` before declaring work done.
- Write commit messages in the past/imperative voice; describe what changed.
- No emoji in code, comments, or commit messages unless the user asks.
- Default to terse comments — JSDoc earns its space; inline comments
  should explain *why*, not *what*.
