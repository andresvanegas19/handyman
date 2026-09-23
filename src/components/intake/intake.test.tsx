import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import Intake from "./intake";

const calls = vi.hoisted(() => ({
  create: vi.fn(), remove: vi.fn(), reserve: vi.fn(), finalize: vi.fn(),
  analyze: vi.fn(), transcribe: vi.fn(), push: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ isConnected: true, hasConvex: true, visualRepairEnabled: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: calls.push }) }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const functions: Record<string, ReturnType<typeof vi.fn>> = {
      "problems:create": calls.create, "problems:remove": calls.remove,
      "uploads:reserve": calls.reserve, "problems:analyze": calls.analyze,
      "problems:transcribe": calls.transcribe,
    };
    const fn = functions[getFunctionName(reference)];
    if (!fn) throw new Error(`Unexpected mutation ${getFunctionName(reference)}`);
    return fn;
  },
  useAction: () => calls.finalize,
}));

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/problems/new?input=audio");
  calls.create.mockResolvedValue("problem-1");
  calls.remove.mockResolvedValue(undefined);
  calls.reserve.mockResolvedValue({ reservationId: "media-1", uploadUrl: "https://uploads.example.test" });
  calls.finalize.mockResolvedValue(undefined);
  calls.analyze.mockResolvedValue("job-1");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ storageId: "storage-1" }))));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:local-photo") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fillSubmission(withPhoto = false) {
  render(<Intake />);
  fireEvent.change(screen.getByLabelText(/What's happening/), { target: { value: "My drawer is sticking" } });
  if (withPhoto) {
    fireEvent.change(screen.getByLabelText("Choose photos"), {
      target: { files: [new File(["fixture"], "drawer.jpg", { type: "image/jpeg" })] },
    });
  }
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Find my next step" }));
}

describe("explicit legacy intake orchestration", () => {
  it("creates an owned text submission before requesting analysis", async () => {
    fillSubmission();
    await waitFor(() => expect(calls.push).toHaveBeenCalledWith("/problems/problem-1"));
    expect(calls.create).toHaveBeenCalledWith({ text: "My drawer is sticking", consent: true });
    expect(calls.analyze).toHaveBeenCalledWith({ problemId: "problem-1" });
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.remove).not.toHaveBeenCalled();
  });

  it("finalizes uploaded media before requesting analysis", async () => {
    fillSubmission(true);
    await waitFor(() => expect(calls.push).toHaveBeenCalled());
    expect(calls.reserve).toHaveBeenCalledWith({ problemId: "problem-1", kind: "photo" });
    expect(calls.finalize).toHaveBeenCalledWith({
      reservationId: "media-1", storageId: "storage-1", durationSeconds: undefined,
    });
    expect(calls.finalize.mock.invocationCallOrder[0]).toBeLessThan(calls.analyze.mock.invocationCallOrder[0]);
  });

  it("cleans a failed submission once and retains the local inputs", async () => {
    calls.finalize.mockRejectedValue(new Error("Invalid photo contents."));
    fillSubmission(true);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid photo contents."));
    expect(calls.remove).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-1" });
    expect(calls.analyze).not.toHaveBeenCalled();
    expect(calls.push).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Your selected photo 1" })).toBeInTheDocument();
  });

  it("reports incomplete cleanup instead of silently hiding a remaining draft", async () => {
    calls.finalize.mockRejectedValue(new Error("Invalid photo contents."));
    calls.remove.mockRejectedValue(new Error("Connection lost."));
    fillSubmission(true);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("An incomplete draft remains in My repairs."));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid photo contents.");
    expect(calls.push).not.toHaveBeenCalled();
  });
});
