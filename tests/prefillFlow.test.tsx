import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fixture from "./fixtures/graph.json";
import { clearBlueprintCache } from "../src/api/blueprint";
import { clearBlueprintListCache } from "../src/api/source";
import { App } from "../src/App";

function mockFetchAlways(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(body) }),
    ),
  );
}

beforeEach(() => {
  localStorage.clear();
  clearBlueprintCache();
  clearBlueprintListCache();
  mockFetchAlways(fixture);
});

afterEach(() => vi.unstubAllGlobals());

describe("prefill flow (e2e)", () => {
  /**
   * @businessValue This is the load-bearing user journey: a user opens a
   * form, picks an upstream field as the prefill source, sees the chip
   * appear, and can clear it. If any step regresses, the product no longer
   * does its one job.
   */
  test("expand form → expand field → pick option → mapping appears → clear", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^Form D\b/ }));
    await user.click(await screen.findByRole("button", { name: "Email" }));

    const emailPanel = await screen.findByRole("region", { name: "Email" });
    const selectButton = within(emailPanel).getByRole("button", { name: "Select" });
    expect(selectButton).toBeDisabled();

    await user.click(within(emailPanel).getByRole("button", { name: "Form A" }));
    const formAPanel = await within(emailPanel).findByRole("region", { name: "Form A" });
    await user.click(within(formAPanel).getByRole("button", { name: "Email" }));
    expect(selectButton).toBeEnabled();

    await user.click(selectButton);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Email: Form A\.Email/ })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Email: Form A\.Email/ }));
    await user.click(await screen.findByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Email: Form A/ })).toBeNull(),
    );
  });

  /**
   * @businessValue CLAUDE.md rule 7: the picker must show every option but
   * disable type-incompatible ones, with the option's `avantos_type` visible
   * so the user understands *why* it's blocked. This guards against future
   * regressions that hide options or strip the type label.
   */
  test("type-incompatible options render disabled and surface the avantos_type", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^Form D\b/ }));
    await user.click(await screen.findByRole("button", { name: "Email" }));

    const emailPanel = await screen.findByRole("region", { name: "Email" });
    await user.click(within(emailPanel).getByRole("button", { name: "Form A" }));
    const formAPanel = await within(emailPanel).findByRole("region", { name: "Form A" });

    // Form A's "Button" field has avantos_type=button → incompatible with a
    // short-text Email target. The row must be disabled and explain why.
    const buttonOption = within(formAPanel).getByRole("button", { name: /Button/ });
    expect(buttonOption).toBeDisabled();
    expect(buttonOption.getAttribute("title")).toMatch(/button.*short-text/);
  });

  /**
   * @businessValue When the user switches blueprints, mappings that no
   * longer point at a valid upstream form must be pruned automatically — a
   * stale chip from the old blueprint shadowing the new one is the bug
   * the prune+seed pipeline was built to prevent.
   */
  test("switching blueprints prunes mappings whose upstream form no longer exists", async () => {
    const user = userEvent.setup();

    // bp-1 (the only server-sourced blueprint) returns the canonical
    // fixture with Form A and Form D. bp-trust (frontend-local) has no
    // Form A — switching to it must prune any mapping pointing there.
    mockFetchAlways(fixture);

    render(<App />);

    // Wire a mapping under bp-1.
    await user.click(await screen.findByRole("button", { name: /^Form D\b/ }));
    await user.click(await screen.findByRole("button", { name: "Email" }));
    const emailPanel = await screen.findByRole("region", { name: "Email" });
    await user.click(within(emailPanel).getByRole("button", { name: "Form A" }));
    const formAPanel = await within(emailPanel).findByRole("region", { name: "Form A" });
    await user.click(within(formAPanel).getByRole("button", { name: "Email" }));
    await user.click(within(emailPanel).getByRole("button", { name: "Select" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Email: Form A\.Email/ })).toBeInTheDocument(),
    );

    // Switch to bp-trust — Form A is gone there, so the chip must be pruned.
    await user.click(screen.getByRole("button", { name: /Estate Trust Setup/ }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Email: Form A/ })).toBeNull(),
    );
  });
});
