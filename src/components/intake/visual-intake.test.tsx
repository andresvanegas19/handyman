import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import Intake from "./intake";

const calls = vi.hoisted(() => ({
  create: vi.fn(), remove: vi.fn(), reserve: vi.fn(), finalize: vi.fn(),
  start: vi.fn(), analyze: vi.fn(), transcribe: vi.fn(), push: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ isConnected: true, hasConvex: true, visualRepairEnabled: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: calls.push }) }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const functions: Record<string, ReturnType<typeof vi.fn>> = {
      "problems:create": calls.create, "problems:remove": calls.remove, "uploads:reserve": calls.reserve,
      "repairPipeline:start": calls.start, "problems:analyze": calls.analyze, "problems:transcribe": calls.transcribe,
    };
    return functions[getFunctionName(reference)];
  },
  useAction: () => calls.finalize,
}));
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/problems/new");
  calls.create.mockResolvedValue("problem-1");
  calls.reserve.mockResolvedValue({ reservationId: "media-1", uploadUrl: "https://uploads.example.test" });
  calls.finalize.mockResolvedValue(undefined);
  calls.start.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ storageId: "storage-1" }))));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:local-photo") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function submit() {
  render(<Intake/>);
  fireEvent.change(screen.getByLabelText(/What's happening/), { target: { value: "My handle is loose" } });
  fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: [new File(["photo"], "handle.jpg", { type: "image/jpeg" })] } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Start visual repair" }));
}
describe("automatic visual intake", () => {
  it("finalizes required media then starts exactly one pipeline and opens progress", async () => {
    submit();
    await waitFor(() => expect(calls.push).toHaveBeenCalledWith("/problems/problem-1"));
    expect(calls.create).toHaveBeenCalledExactlyOnceWith({ text: "My handle is loose", consent: true, workflow: "visual" });
    expect(calls.finalize.mock.invocationCallOrder[0]).toBeLessThan(calls.start.mock.invocationCallOrder[0]);
    expect(calls.start).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-1" });
    expect(calls.analyze).not.toHaveBeenCalled();
    expect(calls.transcribe).not.toHaveBeenCalled();
  });
  it("preserves a possibly accepted start and opens its persistent status after a lost response", async () => {
    calls.start.mockRejectedValue(new Error("Network lost after accepting run"));
    submit();
    await waitFor(() => expect(calls.push).toHaveBeenCalledWith("/problems/problem-1"));
    expect(calls.remove).not.toHaveBeenCalled();
    expect(calls.create).toHaveBeenCalledOnce();
  });
  it("retains the photo, text and consent after an upload failure without starting providers", async () => {
    calls.finalize.mockRejectedValue(new Error("Photo rejected"));
    submit();
    await screen.findByRole("alert");
    expect(screen.getByLabelText(/What's happening/)).toHaveValue("My handle is loose");
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(calls.start).not.toHaveBeenCalled();
    expect(calls.remove).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-1" });
  });
  it("does not create another repair if cleanup of a failed draft is still unavailable", async () => {
    calls.finalize.mockRejectedValue(new Error("Photo rejected"));
    calls.remove.mockRejectedValue(new Error("Cleanup unavailable"));
    submit();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Start visual repair" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Cleanup unavailable"));
    expect(calls.create).toHaveBeenCalledOnce();
  });
  it("keeps the explicit legacy audio entry separate from mandatory visual intake", () => {
    window.history.replaceState(null, "", "/problems/new?input=audio");
    render(<Intake/>);
    expect(screen.getByRole("button", { name: "Record a voice note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start visual repair" })).not.toBeInTheDocument();
  });
});
