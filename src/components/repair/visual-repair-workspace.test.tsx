import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { PrivateMappedScene, RepairSceneManifest, RepairSolution } from "@/lib/visual-repair";
import { PipelineProgress, ReadyRepair, VisualRepairWorkspaceView } from "./visual-repair-workspace";
import ProblemWorkspace from "../problem-workspace";

interface CanvasProps {
  scene: PrivateMappedScene; activePartIds: string[]; focusIds: string[]; focusKey: number;
  onReady: () => void; onError: (message: string) => void;
}
const calls = vi.hoisted(() => ({
  canvas: vi.fn<(props: CanvasProps) => void>(), mount: vi.fn(), unmount: vi.fn(),
  progress: vi.fn(), start: vi.fn(), retry: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ isConnected: true, hasConvex: true, visualRepairEnabled: true }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => "owner-token" }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => getFunctionName(reference) === "problems:get"
    ? { problem: { workflow: "visual" }, media: [], analysis: null, feedback: [] } : calls.progress(),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => getFunctionName(reference) === "repairPipeline:start"
    ? calls.start : getFunctionName(reference) === "repairPipeline:retry" ? calls.retry : calls.remove,
}));
vi.mock("next/dynamic", () => ({ default: () => function MockCanvas(props: CanvasProps) {
  calls.canvas(props);
  useEffect(() => { calls.mount(); return () => calls.unmount(); }, []);
  return <div data-testid="mapped-canvas"/>;
} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const scene: RepairSceneManifest = {
  id: "scene-one", source: "generated",
  parts: [
    { id: "handle", label: "Handle", description: "Visible handle", nodeNames: ["Handle"], explodeOffset: [0, 0, 0] },
    { id: "fixing", label: "Fixing", description: "Visible fixing", nodeNames: ["Fixing"], explodeOffset: [0, 0, 0] },
  ],
};
const solution: RepairSolution = {
  title: "Check the handle", summary: "A supported low-risk draft",
  prerequisites: ["Keep the door still"], stopConditions: ["Stop if anything is cracked"],
  steps: [
    { id: "step-one", title: "Inspect the visible handle", description: "Compare its visible condition", partIds: ["handle"], sourceIds: ["manual"] },
    { id: "step-two", title: "Inspect the fixing", description: "Compare both visible parts", partIds: ["handle", "fixing"], sourceIds: ["manual"] },
  ],
  sources: [{ id: "manual", url: "https://example.com/manual", title: "Manufacturer manual" }],
};
function glb() {
  const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
  const size = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(20 + size);
  const view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, size, 0x4e4f534a].forEach((value, index) => view.setUint32(index * 4, value, true));
  bytes.fill(32, 20);
  bytes.set(json, 20);
  return bytes;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://sample.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(glb()))));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:private-repair") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function ready() {
  await screen.findByTestId("mapped-canvas");
  act(() => calls.canvas.mock.lastCall?.[0].onReady());
}
describe("automatic private 3D workspace", () => {
  it("automatically fetches with owner auth but hides the entire solution until onReady", async () => {
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    await screen.findByTestId("mapped-canvas");
    expect(fetch).toHaveBeenCalledOnce();
    const request = vi.mocked(fetch).mock.calls[0];
    expect(String(request[0])).toBe("https://sample.convex.site/repair-scene?id=scene-one");
    expect(request[1]).toMatchObject({ headers: { Authorization: "Bearer owner-token" }, cache: "no-store" });
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(screen.queryByText(solution.summary)).not.toBeInTheDocument();
    expect(screen.queryByText(solution.prerequisites[0])).not.toBeInTheDocument();
    expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate|Open .*model/ })).not.toBeInTheDocument();
    expect(calls.canvas.mock.lastCall?.[0].focusIds).toEqual([]);
    await ready();
    expect(screen.getByText(solution.title)).toBeInTheDocument();
    expect(calls.canvas.mock.lastCall?.[0].focusIds).toEqual(["handle"]);
    expect(calls.canvas.mock.lastCall?.[0].activePartIds).toEqual(["handle"]);
  });
  it("changes highlights and combined focus without reloading; supports next, previous, keyboard and refocus", async () => {
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit/>);
    await ready();
    const firstKey = calls.canvas.mock.lastCall?.[0].focusKey;
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(calls.canvas.mock.lastCall?.[0].focusIds).toEqual(["handle", "fixing"]);
    expect(calls.canvas.mock.lastCall?.[0].activePartIds).toEqual(["handle", "fixing"]);
    expect(calls.canvas.mock.lastCall?.[0].focusKey).not.toBe(firstKey);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("heading", { name: "2. Inspect the fixing" }), { key: "ArrowLeft" });
    expect(calls.canvas.mock.lastCall?.[0].focusIds).toEqual(["handle"]);
    fireEvent.change(screen.getByLabelText("Repair step"), { target: { value: "1" } });
    const beforeRefocus = calls.canvas.mock.lastCall?.[0].focusKey;
    fireEvent.click(screen.getByRole("button", { name: "Refocus step" }));
    expect(calls.canvas.mock.lastCall?.[0].focusKey).not.toBe(beforeRefocus);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(calls.canvas.mock.lastCall?.[0].focusIds).toEqual(["handle"]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(calls.mount).toHaveBeenCalledOnce();
    expect(calls.unmount).not.toHaveBeenCalled();
  });
  it("locks guidance on mismatch pause and resumes the same loaded model", async () => {
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Pause — object or model/ }));
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(calls.canvas.mock.lastCall?.[0].focusIds).toEqual([]);
    expect(screen.getByText(/Stop working if the object/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume viewing" }));
    expect(screen.getByText(solution.title)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("locks guidance after WebGL/context failure instead of displaying a textual or procedural fallback", async () => {
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    await ready();
    act(() => calls.canvas.mock.lastCall?.[0].onError("WebGL context lost"));
    expect(screen.getByRole("alert")).toHaveTextContent("WebGL context lost");
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(screen.queryByTestId("mapped-canvas")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry 3D viewer" }));
    await ready();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-repair");
  });
  it("aborts downloads and revokes private URLs when auth changes, with no stale instructions", async () => {
    const { rerender, unmount } = render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    await ready();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    rerender(<ReadyRepair scene={scene} solution={solution} token={null} cacheHit={false}/>);
    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-repair");
    expect(screen.getByRole("alert")).toHaveTextContent("session expired");
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
    unmount();
  });
  it("does not create a blob URL for a download completing after unmount", async () => {
    let finish: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    unmount();
    await act(async () => { finish?.(new Response(glb())); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("requires readiness again if a ready artifact changes, even when it reuses a scene ID", async () => {
    const { rerender } = render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    await ready();
    const revised = { ...solution, title: "A newly validated repair draft" };
    rerender(<ReadyRepair scene={scene} solution={revised} token="owner-token" cacheHit/>);
    expect(screen.queryByText(revised.title)).not.toBeInTheDocument();
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-repair");
    await ready();
    expect(screen.getByText(revised.title)).toBeInTheDocument();
  });
  it.each([401, 403, 404, 500])("shows an explicit authenticated fetch error for HTTP %s", async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent(status === 401 || status === 403 ? "authorization expired" : "private model is unavailable");
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(screen.queryByTestId("mapped-canvas")).not.toBeInTheDocument();
  });
  it("rejects invalid model content and incomplete semantic targets before revealing instructions", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not a GLB"));
    const { unmount } = render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("valid binary GLB");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    unmount();
    render(<ReadyRepair scene={scene} solution={{ ...solution, steps: [{ ...solution.steps[0], partIds: ["unknown"] }] }} token="owner-token" cacheHit={false}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("missing a valid model target");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not wait forever for a canvas that never reports readiness", async () => {
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    await screen.findByTestId("mapped-canvas");
    vi.useFakeTimers();
    // Start a fresh loading attempt so its deadline is controlled by fake timers.
    cleanup();
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false}/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(80_001); });
    expect(screen.getByRole("alert")).toHaveTextContent(/timed out|did not become ready/);
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
  });
});
describe("persisted pipeline progress", () => {
  it("exports the production workspace view for deterministic fixtures without invoking backend hooks", () => {
    const remove = vi.fn();
    const retry = vi.fn();
    render(<VisualRepairWorkspaceView data={{ phase: "failed", retryable: true, cacheHit: false }} token={null} onRetry={retry} onDelete={remove}/>);
    expect(calls.progress).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry repair preparation" }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete repair" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(remove).toHaveBeenCalledOnce();
  });
  it("automatically transitions a saved visual repair from progress to model loading and only then instructions", async () => {
    calls.progress.mockReturnValue({ phase: "mapping", retryable: false, cacheHit: false });
    const { rerender } = render(<ProblemWorkspace id="problem-one"/>);
    expect(screen.getByRole("heading")).toHaveTextContent("Matching repair steps");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Add or update the details")).not.toBeInTheDocument();
    calls.progress.mockReturnValue({ phase: "ready", retryable: false, cacheHit: true, scene, solution });
    rerender(<ProblemWorkspace id="problem-one"/>);
    await screen.findByTestId("mapped-canvas");
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(calls.start).not.toHaveBeenCalled();
    await ready();
    expect(screen.getByText(solution.title)).toBeInTheDocument();
    calls.progress.mockReturnValue({ phase: "failed", message: "Source withdrawn", retryable: false, cacheHit: false });
    rerender(<ProblemWorkspace id="problem-one"/>);
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-repair");
  });
  it("uses idempotent start for a saved null-run and the retry endpoint for a failed run", async () => {
    calls.progress.mockReturnValue(null);
    const { rerender } = render(<ProblemWorkspace id="problem-one"/>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry repair preparation" })));
    expect(calls.start).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-one" });
    expect(calls.retry).not.toHaveBeenCalled();
    calls.progress.mockReturnValue({ phase: "failed", message: "Provider unavailable", retryable: true, cacheHit: false });
    rerender(<ProblemWorkspace id="problem-one"/>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry repair preparation" })));
    expect(calls.retry).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-one" });
  });
  it("never leaks an early solution from a non-ready phase", () => {
    render(<PipelineProgress data={{ phase: "mapping", retryable: false, cacheHit: false, solution, scene }} delayed={false} busy={false} onRetry={vi.fn()}/>);
    expect(screen.getByRole("heading")).toHaveTextContent("Matching repair steps");
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });
  it("offers an explicit retry only for retryable terminal states", () => {
    const retry = vi.fn();
    render(<PipelineProgress data={{ phase: "failed", message: "Mapping is unavailable", retryable: true, cacheHit: false }} delayed={false} busy={false} onRetry={retry}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("Mapping is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry repair preparation" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("explains delayed progress rather than an infinite spinner or duplicate paid submission", () => {
    render(<PipelineProgress data={{ phase: "generating_model", retryable: false, cacheHit: false }} delayed busy={false} onRetry={vi.fn()}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("do not submit another repair");
    expect(screen.queryByText("Work continues securely in the background.")).not.toBeInTheDocument();
  });
});
