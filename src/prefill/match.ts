import type { Mapping } from "./types";

/**
 * Shared validation primitive for `PrefillSource.validateMapping`
 * implementations.
 *
 * Returns `raw` re-typed as `Mapping` iff:
 *   - `raw` is a non-null object,
 *   - `sourceId`, `groupId`, `optionId` are all strings, AND
 *   - `raw.sourceId` matches the caller-supplied `id`.
 *
 * Each source plugs in its own id — keeps source files free of
 * boilerplate parsing while preserving the per-source ownership model.
 *
 * @returns A typed `Mapping`, or `null` if the shape doesn't match.
 */
export function matchSource(raw: unknown, id: string): Mapping | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.sourceId !== "string" ||
    typeof candidate.groupId !== "string" ||
    typeof candidate.optionId !== "string"
  ) {
    return null;
  }
  if (candidate.sourceId !== id) return null;
  return {
    sourceId: candidate.sourceId,
    groupId: candidate.groupId,
    optionId: candidate.optionId,
  };
}
