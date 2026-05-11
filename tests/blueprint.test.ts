import { afterEach, describe, expect, test, vi } from "vitest";
import { clearBlueprintCache, fetchBlueprint } from "../src/api/blueprint";

afterEach(() => {
  vi.unstubAllGlobals();
  clearBlueprintCache();
});

describe("fetchBlueprint", () => {
  /**
   * @businessValue On a successful blueprint response, the user must see
   * their forms render — the network helper has to return the parsed body
   * and hit the documented endpoint so the mock server contract is honored.
   */
  test("returns the parsed JSON body for a 200 response", async () => {
    const body = { id: "bp_1", nodes: [], edges: [], forms: [] };
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(body),
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchBlueprint("http://server", "tenant-x", "blueprint-y");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://server/api/v1/tenant-x/actions/blueprints/blueprint-y/graph",
    );
  });

  /**
   * @businessValue When the backend rejects the request (auth lapsed,
   * blueprint missing), the helper must throw a clear, actionable error so
   * App.tsx surfaces a load failure instead of leaving the user staring at
   * an empty list.
   */
  test("throws a status-tagged error when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.resolve({}),
        }),
      ),
    );

    await expect(fetchBlueprint("", "t", "b")).rejects.toThrow(/404 Not Found/);
  });

  /**
   * @businessValue Re-clicking the same blueprint must not re-hit the network;
   * the response is canonical for the session, and a duplicate fetch on every
   * click would slow the UI and leak load to the backend.
   */
  test("returns the cached response on a second call with the same key", async () => {
    const body = { id: "bp_1", nodes: [], edges: [], forms: [] };
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(body),
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const a = await fetchBlueprint("http://server", "tenant-x", "blueprint-y");
    const b = await fetchBlueprint("http://server", "tenant-x", "blueprint-y");

    expect(a).toEqual(body);
    expect(b).toEqual(body);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
