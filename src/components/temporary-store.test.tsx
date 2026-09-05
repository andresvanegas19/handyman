import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { STARTER_GUIDES } from "@/lib/catalog";
import { readTemporaryState, TEMPORARY_STORAGE_KEY } from "@/lib/temporary-storage";
import { TemporaryStorageGate, TemporaryStoreProvider, useTemporaryStore } from "./temporary-store";

function Harness() {
  const store = useTemporaryStore();
  const [error, setError] = useState("");
  const first = store.data.repairs[0];
  return <TemporaryStorageGate>
    <p>{store.data.repairs.length} repairs</p>
    <p>{store.data.ratings.length} ratings</p>
    <p>{first && store.getFile(first.attachments[0]?.id) ? "Attachment in memory" : "No attachment in memory"}</p>
    <button onClick={() => {
      try {
        store.createRepair({
          text: "A squeaky door", photos: [new File(["private image bytes"], "door.jpg", { type: "image/jpeg" })],
          consent: true,
        });
      } catch (error) { setError(error instanceof Error ? error.message : "Save failed"); }
    }}>Create repair</button>
    <button onClick={() => first && store.removeRepair(first.id)}>Delete repair</button>
    <button onClick={() => store.saveRating({ slug: STARTER_GUIDES[0].slug, version: 1, outcome: "worked", comment: "" })}>Worked</button>
    <button onClick={() => store.saveRating({ slug: STARTER_GUIDES[0].slug, version: 1, outcome: "not_worked", comment: "Updated" })}>Did not work</button>
    {error && <p role="alert">{error}</p>}
  </TemporaryStorageGate>;
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = () => render(<TemporaryStoreProvider><Harness/></TemporaryStoreProvider>);

describe("temporary browser storage", () => {
  it("persists metadata but never serializes photos or audio", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Create repair" }));
    expect(screen.getByText("1 repairs")).toBeVisible();
    expect(screen.getByText("Attachment in memory")).toBeVisible();
    const saved = sessionStorage.getItem(TEMPORARY_STORAGE_KEY);
    expect(saved).toContain("door.jpg");
    expect(saved).not.toContain("private image bytes");
    expect(readTemporaryState(sessionStorage).repairs[0].text).toBe("A squeaky door");
  });

  it("restores text after remount without pretending attachments survived", async () => {
    const first = open();
    fireEvent.click(await screen.findByRole("button", { name: "Create repair" }));
    first.unmount();
    open();
    expect(await screen.findByText("1 repairs")).toBeVisible();
    expect(screen.getByText("No attachment in memory")).toBeVisible();
  });

  it("replaces a previous outcome instead of counting it twice", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Worked" }));
    fireEvent.click(screen.getByRole("button", { name: "Did not work" }));
    expect(screen.getByText("1 ratings")).toBeVisible();
    expect(readTemporaryState(sessionStorage).ratings[0]).toMatchObject({ outcome: "not_worked", comment: "Updated" });
  });

  it("deletes both metadata and in-memory media", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Create repair" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete repair" }));
    expect(screen.getByText("0 repairs")).toBeVisible();
    expect(screen.getByText("No attachment in memory")).toBeVisible();
    expect(readTemporaryState(sessionStorage).repairs).toEqual([]);
  });

  it("does not report success when storage is unavailable", async () => {
    open();
    await screen.findByRole("button", { name: "Create repair" });
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    fireEvent.click(screen.getByRole("button", { name: "Create repair" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByText("0 repairs")).toBeVisible();
    expect(screen.getByText("No attachment in memory")).toBeVisible();
  });

  it("keeps existing repairs when the 20-repair limit is reached", async () => {
    open();
    const create = await screen.findByRole("button", { name: "Create repair" });
    for (let index = 0; index < 20; index++) fireEvent.click(create);
    expect(readTemporaryState(sessionStorage).repairs).toHaveLength(20);
    fireEvent.click(create);
    expect(screen.getByRole("alert")).toHaveTextContent("This tab can hold 20 repairs");
    expect(screen.getByText("20 repairs")).toBeVisible();
    expect(readTemporaryState(sessionStorage).repairs).toHaveLength(20);
  });

  it("requires explicit confirmation before clearing malformed stored data", async () => {
    sessionStorage.setItem(TEMPORARY_STORAGE_KEY, "invalid json");
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(sessionStorage.getItem(TEMPORARY_STORAGE_KEY)).toBe("invalid json");
    fireEvent.click(screen.getByRole("button", { name: "Clear this tab's data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));
    await waitFor(() => expect(screen.getByText("0 repairs")).toBeVisible());
    expect(sessionStorage.getItem(TEMPORARY_STORAGE_KEY)).toBeNull();
  });
});
