/**
 * @file Ordered registry of every {@link PrefillSource} the picker
 * surfaces, plus the shared `validateMapping` walker used at load time.
 */

import type { Mapping, PrefillSource } from "./types";
import { endpointSource } from "./sources/endpointSource";
import { formFieldsSource } from "./sources/formFieldsSource";
import { globalDataSource } from "./sources/globalDataSource";

/**
 * The registry. Order is preserved by the picker only within each
 * `kind` bucket — see `FieldPicker.flatten`, which reorders globals →
 * endpoints → graph regardless of array position.
 *
 * **Adding a new prefill source — the only steps required:**
 *
 * 1. Create `src/prefill/sources/<yourSource>.ts` exporting a
 *    `PrefillSource` (see `types.ts` for the contract). `getGroups`
 *    and `resolve` may be sync or async — async is fine for
 *    HTTP-backed sources; FieldPicker awaits both. For
 *    `validateMapping`, use `matchSource(raw, ID)` from `../match`.
 *
 * 2. Append it to the array below. Nothing else in the codebase needs
 *    to change — `useMappings`, prune, `FieldPicker`, `FormList`, and
 *    `App` all read sources through this registry.
 *
 * 3. Add a test file at `tests/<yourSource>.test.ts` mirroring the
 *    structure of `tests/sources.test.ts` (assert `getGroups` output,
 *    `describe()` projection, `isResolvableIn()` truthiness,
 *    `validateMapping` shape).
 *
 * If a change to anything outside steps 1–3 is required, the
 * abstraction is wrong — fix the abstraction (CLAUDE.md hard rule 6),
 * don't paper over it here.
 */
export const sources: PrefillSource[] = [
  formFieldsSource("direct"),
  formFieldsSource("transitive"),
  globalDataSource,
  endpointSource,
  // ← append new PrefillSource(s) here
];

/** Look up a registered source by its `id`, or `undefined` if unknown. */
export function getSource(id: string): PrefillSource | undefined {
  return sources.find((source) => source.id === id);
}

/**
 * Try every registered source's `validateMapping` against `raw`.
 *
 * Returns the first match, or `null` if no source claims it. Used at
 * load time to filter stale entries — e.g. a mapping persisted under
 * a `sourceId` that has since been removed from the registry will be
 * silently dropped.
 */
export function validateMapping(raw: unknown): Mapping | null {
  for (const source of sources) {
    const claimed = source.validateMapping(raw);
    if (claimed) return claimed;
  }
  return null;
}
