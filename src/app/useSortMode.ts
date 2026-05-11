import { useEffect, useState } from "react";

/**
 * Sort mode for the form list.
 *
 * - `"alpha"` — alphabetical by form name.
 * - `"topo"`  — topological order (parents before children).
 * - `"tree"`  — DFS tree projection with branch glyphs (see `treeOrder.ts`).
 */
export type SortMode = "alpha" | "topo" | "tree";

const STORAGE_KEY = "avantos.sortMode.v1";

/**
 * Reactive sort mode mirrored to `localStorage`.
 *
 * Returns `[mode, setMode]`, matching `useState`'s shape so it slots
 * into existing call sites. Default on first load is `"alpha"`.
 */
export function useSortMode() {
  const [mode, setMode] = useState<SortMode>(() => loadFromStorage());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return [mode, setMode] as const;
}

/**
 * Restore the persisted mode. Anything other than the two non-default
 * values falls back to `"alpha"`, which doubles as defensive parsing
 * if a manual localStorage edit corrupts the value.
 */
function loadFromStorage(): SortMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "topo" || raw === "tree") return raw;
  return "alpha";
}
