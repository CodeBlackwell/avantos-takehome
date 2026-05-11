import type { BlueprintResponse } from "../api/blueprint";
import type { Graph } from "../graph/graph";
import { validateMapping } from "../prefill/registry";
import type { Mapping } from "../prefill/types";
import type { MappingsState } from "../prefill/useMappings";
import { nodesSharing } from "./sharing";

/**
 * Pull fixture-supplied default mappings out of each node's
 * `input_mapping`.
 *
 * Each candidate is offered to the registry; entries no source claims
 * are silently dropped. Global mappings on reusable forms are mirrored
 * to every sibling instance (see `sharing.ts`) so the seed matches
 * what the user would see if they committed it interactively.
 *
 * Pure projection — no side effects, no network. Safe to call from
 * effects without cleanup.
 *
 * @returns A `MappingsState` keyed `[nodeId][fieldKey] = mapping`,
 *          ready to feed into `useMappings.seedMappings`.
 */
export function extractSeeds(response: BlueprintResponse, graph: Graph): MappingsState {
  const seeds: MappingsState = {};
  for (const node of response.nodes) {
    const inputMapping = node.data.input_mapping;
    if (!inputMapping || typeof inputMapping !== "object") continue;
    for (const [fieldKey, candidate] of Object.entries(inputMapping)) {
      const mapping = validateMapping(candidate);
      if (!mapping) continue;
      // Fan globals out to every reusable-form sibling. For graph and
      // endpoint mappings, `nodesSharing` returns just `[node.id]`.
      for (const targetNodeId of nodesSharing(graph, node.id, mapping)) {
        const fields = (seeds[targetNodeId] ??= {} as Record<string, Mapping>);
        fields[fieldKey] = mapping;
      }
    }
  }
  return seeds;
}
