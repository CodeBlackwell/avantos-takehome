# Journey Builder — Avantos coding challenge

A React/TS app that fetches a DAG of forms from a mock server and lets the
user view, edit, and clear each field's prefill mapping. Six additional
blueprints ship as frontend-local fixtures and are selectable from the
in-app blueprint picker.

The design story — load-bearing abstraction, hard rules, sharing model,
prune semantics — lives in [`CLAUDE.md`](./CLAUDE.md). Per-module detail
lives in JSDoc on each file's exports.

## Contents

- [Run locally](#run-locally)
- [Blueprints](#blueprints)
- [How it works](#how-it-works)
- [Storage](#storage)
- [Add a new data source](#add-a-new-data-source)
- [Production build](#production-build)
- [Tests](#tests)

## Run locally

Two ways to run the stack — pick one.

### Option A: Node (fastest dev loop)

In one terminal, start the
[mock server](https://github.com/mosaic-avantos/frontendchallengeserver)
on port 3000:

```bash
git clone https://github.com/mosaic-avantos/frontendchallengeserver
cd frontendchallengeserver && npm install && npm start
```

In another, run this app:

```bash
npm install
npm run dev          # http://localhost:5173 — proxies /api → :3000
npm test             # vitest (no server needed)
npm run typecheck
npm run build        # tsc -b && vite build → dist/
```

Vite's dev server proxies `/api` to `http://localhost:3000`, so the
frontend uses relative URLs.

### Option B: Docker (one command, prod-shaped)

`compose.yaml` boots both halves of the stack on a shared Docker network:
the unmodified upstream mock server and this app's nginx-served static
build (the production image).

Prerequisite: clone the upstream server as a **sibling** of this repo.
Compose bind-mounts `../frontendchallengeserver` read-only so the
upstream is run exactly as shipped — graders rebuild against the
upstream, and any local modification would silently invalidate the
submission.

```bash
# from this repo's parent directory
git clone https://github.com/mosaic-avantos/frontendchallengeserver
```

Then, from inside this repo:

```bash
docker compose up --build
# → http://localhost:8080
```

## Blueprints

The selector lists every available blueprint, color-coded by source:

- **Server** (green dot) — `bp-1` only. The upstream server ships exactly
  one fixture and one route, so the live catalog is a single button.
- **Frontend** (amber dot) — six blueprints imported as JSON from
  `src/api/blueprints/` and registered in `src/api/localBlueprints.ts`.
  Each is run through `validateBlueprint()` at module init, so any drift
  in a fixture file (typo'd `avantos_type`, dangling `component_id`,
  edge to a missing node, …) throws at app boot with a
  `<source>: <path>: <reason>` error.

Listed least- to most-complex (the button order); size is the dominant
axis, architectural features act as light tiebreakers:

| Blueprint | Nodes | What it exercises |
|---|---|---|
| `bp-refresh` | 4 | Linear chain (Servicing) |
| `bp-rollover` | 5 | Diamond ancestry (Life Event) |
| `bp-401k` | 5 | `dynamic_field_config` → endpoint source (Retirement) |
| `bp-trust` | 6 | Reusable forms + global-mapping fan-out (Estate Planning) |
| `bp-onboarding` | 7 | Branching (Acquisition) |
| `bp-loan` | 21 (30 edges) | Largest by every measure; 19 nodes seeded with `input_mapping` (Credit) |

`fetchBlueprint` checks the local catalog before hitting the network.
Mappings persist per-field in `localStorage`. Switching blueprints
prunes any mapping whose target node, parent, or referenced option no
longer exists in the new graph, so state never bleeds between
blueprints.

## How it works

- **`src/api/`** — `fetchBlueprint` (cached, dedupe-on-inflight),
  `fetchBlueprintList` (server probe + local fixtures merged),
  `fetchEndpoint` (faked `dynamic_field_config` transport),
  `validateBlueprint` (runtime shape check).
- **`src/graph/`** — `buildGraph` walks `edges[]` (canonical) to build the
  parent index, topo order, and `nodesByFormId` reverse index.
  `node.data.prerequisites` is ignored as a denormalization.
- **`src/prefill/`** — the `PrefillSource` contract, source registry, and
  the four shipping sources (direct, transitive, global, endpoint).
- **`src/app/`** — App-level helpers (tree layout, fixture seeding,
  dep map, prune, sharing).
- **`src/components/`** — form list, per-field picker, ELK-laid graph view.

The picker is registry-driven: it asks each `PrefillSource` for its
groups and renders the union. It does not branch on source type;
ordering is the only kind-aware logic.

### The picker

Clicking a field opens an inline picker:

- **Target row** — field name + `avantos_type` badge.
- **Group accordion** — one item per `(source, group)` pair, in
  globals → endpoints → graph order.
- **Staged-mapping caption** — *"Pre-fills `<field>` in `<form>` with
  `<option>` from `<group>`"* — appears once a pending choice is made.

Type-incompatible options stay visible but disabled with a tooltip
explaining the mismatch, so the user can see *why* a row is blocked.

### Sharing across reusable forms

When `form.is_reusable` is true, multiple nodes can reference the same
`component_id`. The app shares **only global-source mappings** across
those instances — graph- and endpoint-source mappings stay per-node
because their resolvability is per-instance.

`bp-trust` is the canonical scenario: three nodes (Primary / Contingent /
Remainder Beneficiary) share one form; a `currentUser.email` mapping
wired on any one fans out to the other two.

## Storage

Three `localStorage` keys, all namespaced `avantos.`:

| Key | Shape | Purpose |
|---|---|---|
| `avantos.mappings.v1` | `Record<NodeId, Record<FieldKey, Mapping>>` | The user's prefill choices. Mappings are pointers (`{ sourceId, groupId, optionId }`), not values. |
| `avantos.mappings.lastSeed.v1` | Same shape | Snapshot of the last fixture seed applied. Lets `seedMappings` distinguish "user untouched" from "user-edited" so blueprint reloads don't clobber edits. |
| `avantos.sortMode.v1` | `"alpha" \| "topo" \| "tree"` | Sort-mode preference. |

Read-time validation runs every persisted entry through
`validateMapping`; anything no registered source claims is silently
dropped.

**Not stored:** resolved values (computed on demand by `source.resolve()`),
in-memory caches (blueprint payloads, endpoint responses, globals — all
die with the tab).

## Add a new data source

Create one file under `src/prefill/sources/` exporting a `PrefillSource`,
then append it to the array in `src/prefill/registry.ts`. The picker,
storage, prune, fixture seeding, and graph view all stay untouched.

```ts
// src/prefill/sources/myThingSource.ts
import type { PrefillSource } from "../types";
import { matchSource } from "../match";

const ID = "my-thing";

export const myThingSource: PrefillSource = {
  id: ID,
  label: "My Thing",
  kind: "global",                                  // or "graph" | "endpoint"
  getGroups: (ctx)        => [/* SourceGroup[] */],
  resolve:   (mapping, ctx) => /* the value */ null,
  describe:  (mapping, graph) => ({
    triggerLabel: `My Thing.${mapping.optionId}`,
    sourceFormName: "My Thing",
    sourceFieldTitle: mapping.optionId,
  }),
  validateMapping: (raw) => matchSource(raw, ID),
  isResolvableIn:  (mapping, ctx) => /* boolean */ true,
};
```

`getGroups` and `resolve` may be sync or async — call sites always
`await`. `describe` and `isResolvableIn` are sync (prune calls the
latter on every load). See `src/prefill/types.ts` for the full
contract.

### Shipping sources

| Source | Kind | Backed by |
|---|---|---|
| `formFieldsSource("direct")` | graph | Direct parents of the target node |
| `formFieldsSource("transitive")` | graph | Transitive ancestors (excludes direct parents; the two are disjoint) |
| `globalDataSource` | global | `currentUser`, `clientOrg` (faked via `loadGlobals()`) |
| `endpointSource` | endpoint | The target form's `dynamic_field_config` entries (faked via `fetchEndpoint()`) |

## Production build

`Dockerfile` is a two-stage build: `node:20-alpine` runs `vite build`,
then the `dist/` output is served by `nginx:alpine` using `nginx.conf`.
The frontend is fully static; nginx proxies `/api/` to a sibling
`server` container.

`compose.yaml` boots two services:

- **`server`** — the **unmodified** upstream mock server, run from
  `../frontendchallengeserver` via a read-only bind mount on
  `node:20-alpine`. Every scenario beyond `bp-1` lives in the frontend
  (auto-discovered local catalog), never on the server.
- **`web`** — this image, served on `:8080`.

Building the image alone (`docker build -t avantos-journey-builder .`)
gives you a static frontend, but loading the page surfaces 502s on
`/api/` until something is reachable at `http://server:3000` on the
same Docker network.

## Tests

```bash
npm test               # vitest, 71 tests across 12 files
npm run test:watch
```

The suite covers:

- **Pure modules** — `graph`, `sources`, `endpointSource`, `prune`,
  `seeds` (incl. reusable-form fan-out), `treeOrder`, `useMappings`,
  `compat`.
- **Wire format guard** — `validateBlueprint.test.ts` locks in the
  fail-fast errors for typo'd `avantos_type`, dangling `component_id`,
  unknown edge targets, and missing top-level fields.
- **Fetch behavior** — URL construction, error surfacing, per-id
  cache dedupe.
- **Integration** — `prefillFlow.test.tsx` renders the full app,
  wires a mapping, switches blueprints, and asserts the chip is pruned.

Tests don't need the mock server running — they import
`tests/fixtures/graph.json` directly and stub `fetch` where needed.
