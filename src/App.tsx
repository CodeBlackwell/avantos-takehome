import { useEffect, useMemo, useState } from "react";
import { fetchBlueprint, type BlueprintResponse } from "./api/blueprint";
import { API_PROXY_BASE, TENANT_ID, fetchBlueprintList } from "./api/source";
import { buildGraph, type Graph } from "./graph/graph";
import { AppShell } from "./components/AppShell";
import { SortControl } from "./components/SortControl";
import { FormList } from "./components/FormList";
import { GraphView } from "./components/GraphView";
import { BlueprintSelector, type BlueprintOption } from "./components/BlueprintSelector";
import { getSource } from "./prefill/registry";
import { loadGlobals } from "./prefill/sources/globalsClient";
import { useMappings } from "./prefill/useMappings";
import { useSortMode, type SortMode } from "./app/useSortMode";
import type { BlueprintNode } from "./api/blueprint";
import type { Mapping } from "./prefill/types";
import { buildTreeOrder, type TreeRow } from "./app/treeOrder";
import { extractSeeds } from "./app/seeds";
import { buildDepsByNode } from "./app/deps";
import { nodesSharing } from "./app/sharing";

/**
 * Top-level page component. Owns:
 *   - the blueprint catalog (selector list),
 *   - the currently loaded blueprint payload + derived `Graph`,
 *   - the mappings store (via `useMappings`),
 *   - sort mode (via `useSortMode`),
 *   - error state.
 *
 * Two boot effects run sequentially:
 *   1. Load globals + blueprint catalog in parallel.
 *   2. Once the user picks a blueprint (auto-set to the first
 *      catalog entry), fetch its payload, prune stale mappings,
 *      then seed fixture defaults.
 */
export function App() {
  const [blueprintList, setBlueprintList] = useState<BlueprintOption[] | null>(null);
  const [blueprintId, setBlueprintId] = useState<string | null>(null);
  const [response, setResponse] = useState<BlueprintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { mappings, setMapping, clearMapping, seedMappings, pruneMappings } = useMappings();
  const [sortMode, setSortMode] = useSortMode();

  // Boot: load globals + blueprint catalog in parallel before the
  // first blueprint fetch. Globals must be primed before prune runs
  // (its `isResolvableIn` is sync and reads from the loaded cache).
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGlobals(), fetchBlueprintList()])
      .then(([, catalog]) => {
        if (cancelled) return;
        setBlueprintList(catalog);
        setBlueprintId(catalog[0]?.id ?? null);
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-blueprint load: fetch payload, prune stale mappings, then
  // seed fixture defaults. Order matters — pruning first prevents a
  // stale entry from a prior blueprint from shadowing a new seed.
  useEffect(() => {
    if (!blueprintId) return;
    let cancelled = false;
    setResponse(null);
    setError(null);
    fetchBlueprint(API_PROXY_BASE, TENANT_ID, blueprintId)
      .then((nextResponse) => {
        if (cancelled) return;
        const nextGraph = buildGraph(nextResponse);
        setResponse(nextResponse);
        pruneMappings(nextGraph);
        seedMappings(extractSeeds(nextResponse, nextGraph));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [blueprintId, seedMappings, pruneMappings]);

  // Memoized derived data — recomputed only when their inputs change.
  // `graph` is the indexed view; `sortedNodes`/`treeRows` feed `FormList`;
  // `depsByNode` feeds `GraphView`'s in-tile rows + tooltip.
  const graph = useMemo(() => (response ? buildGraph(response) : null), [response]);
  const { sortedNodes, treeRows } = useMemo(() => {
    if (!graph) return { sortedNodes: [], treeRows: [] as TreeRow[] };
    if (sortMode === "tree") {
      const { order, rows } = buildTreeOrder(graph);
      return { sortedNodes: order, treeRows: rows };
    }
    return {
      sortedNodes: sortNodes(graph.nodes, graph, sortMode),
      treeRows: [] as TreeRow[],
    };
  }, [graph, sortMode]);
  const depsByNode = useMemo(() => buildDepsByNode(graph, mappings), [graph, mappings]);

  if (error)
    return (
      <p role="alert" className="p-6 text-destructive">
        Failed to load blueprint: {error}
      </p>
    );
  if (!graph) return <p className="p-6 text-muted-foreground">Loading blueprint…</p>;

  return (
    <AppShell
      title={response?.name ?? "Journey Builder"}
      subtitle={response?.description}
      category={response?.category}
    >
      <div className="w-56">
        <SortControl value={sortMode} onChange={setSortMode} />
      </div>

      <FormList
        nodes={sortedNodes}
        graph={graph}
        mappings={mappings}
        sortMode={sortMode}
        treeRows={treeRows}
        describeMapping={(mapping) => describeMapping(mapping, graph)}
        onCommit={(nodeId, fieldKey, mapping) => {
          // Global mappings on reusable forms mirror to every sibling
          // instance. Graph-source and endpoint mappings stay per-node
          // (their resolvability differs by ancestor/instance).
          for (const id of nodesSharing(graph, nodeId, mapping)) {
            setMapping(id, fieldKey, mapping);
          }
        }}
        onClear={(nodeId, fieldKey) => {
          // If the cleared mapping was shared, clear it from every
          // sibling. Look at the existing entry to decide; falls back
          // to single-node clear when nothing is set.
          const existing = mappings[nodeId]?.[fieldKey];
          const targets = existing ? nodesSharing(graph, nodeId, existing) : [nodeId];
          for (const id of targets) clearMapping(id, fieldKey);
        }}
      />

      {blueprintList && blueprintId && (
        <BlueprintSelector
          options={blueprintList}
          value={blueprintId}
          onChange={setBlueprintId}
        />
      )}

      <GraphView
        nodes={graph.nodes}
        edges={graph.edges}
        selectedId={null}
        depsByNode={depsByNode}
      />
    </AppShell>
  );
}

/**
 * Sort the blueprint's nodes for the form list.
 *
 * - `"alpha"` sorts by display name.
 * - `"topo"`  sorts by `topoIndex` so parents precede children.
 * - `"tree"`  is handled by `buildTreeOrder` upstream and never reaches here.
 *
 * Returns a new array — never mutates the input.
 */
function sortNodes(nodes: BlueprintNode[], graph: Graph, mode: SortMode): BlueprintNode[] {
  const copy = nodes.slice();
  if (mode === "alpha") {
    copy.sort((a, b) => a.data.name.localeCompare(b.data.name));
  } else {
    copy.sort((a, b) => (graph.topoIndex.get(a.id) ?? 0) - (graph.topoIndex.get(b.id) ?? 0));
  }
  return copy;
}

/**
 * Project a `Mapping` to its inline trigger label (e.g. `"Form B.Email"`).
 *
 * Falls back to `"<groupId>.<optionId>"` if the source has been
 * deregistered between commit and render — defensive; the registry
 * doesn't change at runtime today.
 */
function describeMapping(mapping: Mapping, graph: Graph): string {
  const source = getSource(mapping.sourceId);
  if (!source) return `${mapping.groupId}.${mapping.optionId}`;
  return source.describe(mapping, graph).triggerLabel;
}
