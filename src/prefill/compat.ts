import type { AvantosType } from "../api/blueprint";

/**
 * Whether a source option of type `source` can prefill a target field
 * of type `target`.
 *
 * Strict equality today — only same-tag pairs are compatible. Loosening
 * (e.g. `"short-text" → "multi-line-text"`) is a UX call; keep it
 * conservative until product asks otherwise. The picker uses the
 * negated result to disable (not hide) incompatible rows so the user
 * can still see *why* an option is blocked.
 */
export function isCompatible(target: AvantosType, source: AvantosType): boolean {
  return target === source;
}
