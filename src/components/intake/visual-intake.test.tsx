import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import Intake from "./intake";

const calls = vi.hoisted(() => ({
  create: vi.fn(), remove: vi.fn(), reserve: vi.fn(), finalize: vi.fn(),
  start: vi.fn(), analyze: vi.fn(), transcribe: vi.fn(), push: vi.fn(),
}));
const config = vi.hoisted(() => ({ visualRepairEnabled: true }));
vi.mock("@/lib/config", () => ({ isConnected: true, hasConvex: true, get visualRepairEnabled() { return config.visualRepairEnabled; } }));
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
  config.visualRepairEnabled = true;
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
  it("shows setup rather than silently submitting to legacy analysis when visual repair is disabled", () => {
    config.visualRepairEnabled = false;
    render(<Intake/>);
    expect(screen.getByRole("alert")).toHaveTextContent("Automatic 3D repair is not enabled yet.");
    expect(screen.getByText(/Required: a written description and a photo/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/What's happening/), { target: { value: "My handle is loose" } });
    fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: [new File(["photo"], "handle.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Start visual repair" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Describe your repair" }));
    expect(calls.create).not.toHaveBeenCalled();
    expect(calls.analyze).not.toHaveBeenCalled();
    expect(calls.start).not.toHaveBeenCalled();
    expect(calls.push).not.toHaveBeenCalled();
  });

  it("keeps legacy input an explicit choice even when visual repair is disabled", () => {
    config.visualRepairEnabled = false;
    window.history.replaceState(null, "", "/problems/new?input=audio");
    render(<Intake/>);
    expect(screen.getByText(/This separate workflow does not automatically prepare a 3D guide/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find my next step" })).toBeInTheDocument();
    expect(screen.queryByText("Automatic 3D repair is not enabled yet.")).not.toBeInTheDocument();
  });

  it("finalizes required media then starts exactly one pipeline and opens progress", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    submit();
    await waitFor(() => expect(calls.push).toHaveBeenCalledWith("/problems/problem-1"));
    expect(calls.create).toHaveBeenCalledExactlyOnceWith({ text: "My handle is loose", consent: true, workflow: "visual", clientRequestId: expect.any(String) });
    expect(calls.finalize.mock.invocationCallOrder[0]).toBeLessThan(calls.start.mock.invocationCallOrder[0]);
    expect(calls.start).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-1" });
    expect(calls.analyze).not.toHaveBeenCalled();
    expect(calls.transcribe).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Saving your repair…" })).toBeDisabled();
    for (const event of ["intake.create.started", "intake.create.completed", "intake.photo.reserve", "intake.photo.upload", "intake.photo.response", "intake.photo.finalize", "intake.photo.completed", "intake.pipeline.start", "intake.pipeline.accepted"]) {
      expect(info).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event }));
    }
    expect(JSON.stringify(info.mock.calls)).not.toContain("My handle is loose");
  });
  it("reuses the same creation UUID after a lost response for unchanged inputs", async () => {
    calls.create.mockRejectedValueOnce(new Error("Create response lost"));
    submit();
    await screen.findByRole("alert");
    const firstId = calls.create.mock.calls[0][0].clientRequestId;
    expect(firstId).toMatch(/^[a-f0-9-]{36}$/);
    fireEvent.click(screen.getByRole("button", { name: "Start visual repair" }));
    await waitFor(() => expect(calls.push).toHaveBeenCalledWith("/problems/problem-1"));
    expect(calls.create.mock.calls[1][0].clientRequestId).toBe(firstId);
    expect(calls.reserve).toHaveBeenCalledOnce();
    expect(calls.start).toHaveBeenCalledOnce();
  });
  it.each(["description", "photo"])("uses a new creation UUID when the %s changes after an ambiguous create", async field => {
    calls.create.mockRejectedValueOnce(new Error("Create response lost"));
    submit();
    await screen.findByRole("alert");
    const firstId = calls.create.mock.calls[0][0].clientRequestId;
    if (field === "description") {
      fireEvent.change(screen.getByLabelText(/What's happening/), { target: { value: "A different handle problem" } });
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: [new File(["different photo"], "new.jpg", { type: "image/jpeg" })] } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Start visual repair" }));
    await waitFor(() => expect(calls.push).toHaveBeenCalled());
    expect(calls.create.mock.calls[1][0].clientRequestId).not.toBe(firstId);
  });
  it("rotates the creation UUID after confirmed cleanup of an upload failure", async () => {
    calls.finalize.mockRejectedValueOnce(new Error("Photo rejected"));
    submit();
    await screen.findByRole("alert");
    const firstId = calls.create.mock.calls[0][0].clientRequestId;
    expect(calls.remove).toHaveBeenCalledOnce();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ storageId: "storage-2" })));
    fireEvent.click(screen.getByRole("button", { name: "Start visual repair" }));
    await waitFor(() => expect(calls.push).toHaveBeenCalled());
    expect(calls.create.mock.calls[1][0].clientRequestId).not.toBe(firstId);
  });
  it("cannot re-submit uploads after handing off an accepted start while navigation is pending", async () => {
    submit();
    await waitFor(() => expect(calls.push).toHaveBeenCalled());
    fireEvent.submit(screen.getByRole("form", { name: "Describe your repair" }));
    expect(calls.create).toHaveBeenCalledOnce();
    expect(calls.reserve).toHaveBeenCalledOnce();
    expect(calls.start).toHaveBeenCalledOnce();
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
