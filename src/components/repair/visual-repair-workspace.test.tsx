import "@testing-library/jest-dom/vitest";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { phaseLabels, type PrivateMappedScene, type RepairRecommendations, type RepairSceneManifest, type RepairSolution } from "@/lib/visual-repair";
import { PipelineProgress, ReadyPreview, ReadyRepair, VisualRepairWorkspaceView } from "./visual-repair-workspace";
import ProblemWorkspace from "../problem-workspace";

interface CanvasProps {
  scene: PrivateMappedScene; activePartIds: string[]; focusIds: string[]; focusKey: number;
  onReady: () => void; onError: (message: string) => void;
}
interface PreviewProps {
  url: string; resetKey: number; fill: boolean;
  onReady: () => void; onError: (message: string) => void;
}
const calls = vi.hoisted(() => ({
  canvas: vi.fn<(props: CanvasProps) => void>(), mount: vi.fn(), unmount: vi.fn(),
  preview: vi.fn<(props: PreviewProps) => void>(),
  progress: vi.fn(), start: vi.fn(), retry: vi.fn(), remove: vi.fn(), cancel: vi.fn(), reportViewerFailure: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ isConnected: true, hasConvex: true, visualRepairEnabled: true }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => "owner-token" }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => getFunctionName(reference) === "problems:get"
    ? { problem: { workflow: "visual" }, media: [], analysis: null, feedback: [] } : calls.progress(),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => getFunctionName(reference) === "repairPipeline:start"
    ? calls.start : getFunctionName(reference) === "repairPipeline:retry" ? calls.retry : getFunctionName(reference) === "repairPipeline:cancel" ? calls.cancel : getFunctionName(reference) === "repairPipeline:reportViewerFailure" ? calls.reportViewerFailure : calls.remove,
}));
vi.mock("next/dynamic", () => ({ default: () => function MockCanvas(props: CanvasProps | PreviewProps) {
  if ("url" in props) calls.preview(props); else calls.canvas(props);
  useEffect(() => { calls.mount(); return () => calls.unmount(); }, []);
  return <div data-testid={"url" in props ? "preview-canvas" : "mapped-canvas"}/>;
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
const recommendations: RepairRecommendations = {
  summary: "Confirm the handle model before choosing replacement parts.",
  urgent: false,
  identification: { product: "Door handle", brand: "Example Hardware", model: "H-20", confidence: 0.84 },
  visionModel: "example/vision-model",
  items: [{ title: "Check the product documentation", description: "Compare the visible label with the manufacturer manual without disassembling the handle." }],
  questions: ["What text is visible on the product label?"],
  sources: [{ title: "Handle documentation", url: "https://example.com/handle-manual" }],
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
  calls.reportViewerFailure.mockResolvedValue(null);
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
describe("model-only visual previews", () => {
  it("opens a generated model without a repair solution or fabricated part mappings", async () => {
    render(<VisualRepairWorkspaceView data={{ phase: "ready", retryable: false, cacheHit: false, preview: { id: "preview-one" }, recommendations }} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
    await screen.findByTestId("preview-canvas");
    expect(screen.getByRole("status")).toHaveTextContent("Loading your 3D visual preview");
    act(() => calls.preview.mock.lastCall?.[0].onReady());
    expect(screen.getByRole("heading", { name: "Your 3D visual preview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download 3D model (GLB)" })).toHaveAttribute("href", "blob:private-repair");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByText(recommendations.items[0].description)).toBeInTheDocument();
    expect(calls.canvas).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    const reset = calls.preview.mock.lastCall?.[0].resetKey;
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(calls.preview.mock.lastCall?.[0].resetKey).not.toBe(reset);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("shows an explicit preview error and retries only the viewer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
    const report = vi.fn();
    render(<ReadyPreview sceneId="preview-one" token="owner-token" cacheHit={false} recommendations={recommendations} onViewerFailure={report}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("private model is unavailable");
    expect(report).toHaveBeenCalledWith("download_failed", "preview-one");
    expect(screen.getByText(recommendations.items[0].description)).toBeInTheDocument();
    expect(calls.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry 3D viewer" }));
    await screen.findByTestId("preview-canvas");
    act(() => calls.preview.mock.lastCall?.[0].onReady());
    expect(screen.getByRole("heading", { name: "Your 3D visual preview" })).toBeInTheDocument();
  });
  it("revokes preview downloads and descriptive context when the session expires", async () => {
    const { rerender } = render(<ReadyPreview sceneId="preview-one" token="owner-token" cacheHit recommendations={{ ...recommendations, imageDescription: "A visible washer control" }}/>);
    await screen.findByTestId("preview-canvas");
    rerender(<ReadyPreview sceneId="preview-one" token={null} cacheHit recommendations={recommendations}/>);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-repair");
    expect(screen.queryByRole("link", { name: "Download 3D model (GLB)" })).not.toBeInTheDocument();
    expect(screen.queryByText("A visible washer control")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("session expired");
  });
});

describe("automatic private 3D workspace", () => {
  it.each(["referral", "needs_input", "researching", "generating_model", "failed"] as const)("shows image-to-text in %s without requiring a product name or unlocking instructions", phase => {
    const imageDescription = "A sink drain and hands holding a wrench are visible.";
    const data = { phase, retryable: false, cacheHit: false, recommendations: {
      ...recommendations, identification: undefined, imageDescription, visibleFeatures: ["P-trap", "wrench"],
    } };
    const { rerender } = render(<VisualRepairWorkspaceView data={data} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
    expect(screen.getByRole("region", { name: "Image description" })).toHaveTextContent(imageDescription);
    expect(screen.getByText("P-trap")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
    expect(screen.getByText(recommendations.items[0].description)).toBeInTheDocument();
    rerender(<VisualRepairWorkspaceView data={{ ...data, phase: "cancelled" }} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
    expect(screen.queryByRole("region", { name: "Image description" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
  });

  it("shows saved visible features when an older recognition has no caption", () => {
    render(<PipelineProgress data={{ phase: "referral", retryable: false, cacheHit: false, recommendations: {
      ...recommendations, identification: undefined, visibleFeatures: ["sink basin", "P-trap"],
    } }} delayed={false} busy={false} onRetry={vi.fn()}/>);
    expect(screen.getByRole("region", { name: "Image description" })).toHaveTextContent("sink basin");
    expect(screen.queryByRole("heading", { name: "Tentative object identification" })).not.toBeInTheDocument();
  });

  it("keeps the image description visible while the ready model downloads or fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const imageDescription = "A round handle is visible on a cabinet.";
    render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false} recommendations={{ ...recommendations, imageDescription }}/>);
    expect(screen.getByRole("region", { name: "Image description" })).toHaveTextContent(imageDescription);
    await screen.findByRole("alert");
    expect(screen.getByRole("region", { name: "Image description" })).toHaveTextContent(imageDescription);
    expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
  });

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
  it.each(["queued", "recognizing", "checking_cache", "researching", "planning", "generating_model", "segmenting", "mapping", "validating"] as const)("keeps %s loading, including delayed stages, until an explicit result", phase => {
    const { container, rerender } = render(<PipelineProgress data={{ phase, retryable: false, cacheHit: false }} delayed busy={false} onRetry={vi.fn()}/>);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    rerender(<PipelineProgress data={{ phase: "failed", retryable: true, cacheHit: false }} delayed={false} busy={false} onRetry={vi.fn()}/>);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
  });
  describe("advisory is available before 3D while interactive steps stay gated", () => {
    it.each(["referral", "needs_input"] as const)("offers explicit saved-photo analysis for a retryable %s without completed vision", phase => {
      const retry = vi.fn();
      render(<VisualRepairWorkspaceView data={{ phase, retryable: true, cacheHit: false, recommendations: { ...recommendations, identification: undefined, visionModel: undefined } }} token="owner-token" onRetry={retry} onDelete={vi.fn()}/>);
      expect(retry).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Analyze saved photo" }));
      expect(retry).toHaveBeenCalledOnce();
    });
    it("keeps the normal retry label after completed vision", () => {
      render(<PipelineProgress data={{ phase: "referral", retryable: true, cacheHit: false, recommendations }} delayed={false} busy={false} onRetry={vi.fn()}/>);
      expect(screen.getByRole("button", { name: "Retry repair preparation" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Analyze saved photo" })).not.toBeInTheDocument();
    });
    it("shows useful referral guidance and tentative identification without a model", () => {
      render(<VisualRepairWorkspaceView data={{ phase: "referral", retryable: false, cacheHit: false, recommendations }} token={null} onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(phaseLabels.referral);
      expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
      expect(screen.getByText(recommendations.summary)).toBeInTheDocument();
      expect(screen.getByText("Door handle")).toBeInTheDocument();
      expect(screen.getByText("Example Hardware")).toBeInTheDocument();
      expect(screen.getByText("H-20")).toBeInTheDocument();
      expect(screen.getByText("84% · not a guarantee")).toBeInTheDocument();
      expect(screen.getByText(/AI estimate · unconfirmed/)).toBeInTheDocument();
      expect(screen.getByText("example/vision-model")).toBeInTheDocument();
      expect(screen.getByText(/Image recognition via OpenRouter/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Handle documentation" })).toBeInTheDocument();
      expect(screen.getByText(recommendations.questions[0])).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add these details in a new repair" })).toBeInTheDocument();
      expect(screen.queryByText(/Contact a qualified professional; for immediate danger/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
    it.each(["queued", "recognizing", "checking_cache", "researching", "planning", "generating_model", "segmenting", "mapping", "validating", "needs_input", "referral", "failed"] as const)("shows advisory but withholds mapped repair steps in %s", phase => {
      render(<VisualRepairWorkspaceView data={{ phase, message: "Provider could not prepare the model", retryable: phase === "failed", cacheHit: false, recommendations, scene, solution }} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.getByText("Provider could not prepare the model")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
      expect(screen.getByText(recommendations.items[0].description)).toBeInTheDocument();
      expect(screen.getByText(recommendations.questions[0])).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Handle documentation" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(phaseLabels[phase]);
      expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
      expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
    it("keeps advisory available before readiness and after rendering fails, but relocks hands-on steps", async () => {
      render(<VisualRepairWorkspaceView data={{ phase: "ready", retryable: false, cacheHit: false, recommendations, scene, solution }} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.getByText(recommendations.summary)).toBeInTheDocument();
      expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
      await ready();
      expect(screen.getByText(recommendations.summary)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Handle documentation" })).toHaveAttribute("href", "https://example.com/handle-manual");
      expect(screen.getByRole("link", { name: "Handle documentation" })).toHaveAttribute("rel", "noopener noreferrer");
      expect(screen.getByText(recommendations.questions[0])).toBeInTheDocument();
      expect(screen.getByText(solution.steps[0].description)).toBeInTheDocument();
      act(() => calls.canvas.mock.lastCall?.[0].onError("WebGL context lost"));
      expect(screen.getByRole("alert")).toHaveTextContent("WebGL context lost");
      expect(screen.getByText(recommendations.summary)).toBeInTheDocument();
      expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
    });
    it("keeps advisory after a private model download failure", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
      render(<VisualRepairWorkspaceView data={{ phase: "ready", retryable: false, cacheHit: false, recommendations, scene, solution }} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(await screen.findByRole("alert")).toHaveTextContent("private model is unavailable");
      expect(screen.getByText(recommendations.summary)).toBeInTheDocument();
      expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    });
    it("shows advisory but never hands-on steps when the saved model mapping is invalid", () => {
      render(<VisualRepairWorkspaceView data={{ phase: "ready", retryable: false, cacheHit: false, recommendations, scene: { ...scene, parts: [] }, solution }} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.getByRole("alert")).toHaveTextContent("missing its mapped model");
      expect(screen.getByText(recommendations.summary)).toBeInTheDocument();
      expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
    it("shows advisory for an incomplete ready response only while the owner token is present", () => {
      const data = { phase: "ready" as const, retryable: false, cacheHit: false, recommendations, solution };
      const { rerender } = render(<VisualRepairWorkspaceView data={data} token="owner-token" onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.getByText(recommendations.summary)).toBeInTheDocument();
      expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
      rerender(<VisualRepairWorkspaceView data={data} token={null} onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
      expect(screen.queryByText(recommendations.identification!.product)).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
    it("keeps delayed guidance useful without duplicated status or promises of successful background work", () => {
      const data = { phase: "recognizing" as const, message: phaseLabels.recognizing, retryable: false, cacheHit: false, recommendations };
      const { rerender } = render(<PipelineProgress data={data} delayed={false} busy={false} onRetry={vi.fn()}/>);
      expect(screen.getAllByText(phaseLabels.recognizing)).toHaveLength(1);
      expect(screen.queryByText("Work continues securely in the background.")).not.toBeInTheDocument();
      expect(screen.getByText(recommendations.items[0].description)).toBeInTheDocument();
      rerender(<PipelineProgress data={data} delayed busy={false} onRetry={vi.fn()}/>);
      expect(screen.getByRole("alert")).toHaveTextContent("taking longer than expected");
      expect(screen.getByText(recommendations.items[0].description)).toBeInTheDocument();
    });
    it("hides recommendations on pause and session expiration", async () => {
      const { rerender } = render(<ReadyRepair scene={scene} solution={solution} recommendations={recommendations} token="owner-token" cacheHit={false}/>);
      await ready();
      expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Pause — object or model/ }));
      expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
      expect(screen.queryByText(recommendations.identification!.product)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Handle documentation" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Resume viewing" }));
      expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
      rerender(<ReadyRepair scene={scene} solution={solution} recommendations={recommendations} token={null} cacheHit={false}/>);
      expect(screen.getByRole("alert")).toHaveTextContent("session expired");
      expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
      expect(screen.queryByText(recommendations.identification!.product)).not.toBeInTheDocument();
    });
    it("keeps urgent safety warnings prominent instead of suggesting hands-on work", () => {
      render(<VisualRepairWorkspaceView data={{ phase: "referral", retryable: false, cacheHit: false, recommendations: { ...recommendations, urgent: true, summary: "A gas smell requires immediate professional assistance." } }} token={null} onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(phaseLabels.referral);
      const safety = screen.getByText(/Stop work. Do not attempt hazardous disassembly/).closest('[role="alert"]');
      expect(safety).toHaveTextContent("local emergency services");
      expect(safety).toHaveTextContent("A gas smell");
      expect(screen.getByText(recommendations.items[0].description)).toBeInTheDocument();
      expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
    });

    describe("owner-correlated viewer failure diagnostics", () => {
      it.each(["failed", "referral", "needs_input", "ready"] as const)("shows a phase-specific heading in %s but reports only malformed ready responses", phase => {
        const report = vi.fn();
        const data = { phase, retryable: false, cacheHit: false, message: "Original provider failure", recommendations };
        const { rerender } = render(<StrictMode><VisualRepairWorkspaceView data={data} token={null} onRetry={vi.fn()} onDelete={vi.fn()} onViewerFailure={report}/></StrictMode>);
        rerender(<StrictMode><VisualRepairWorkspaceView data={{ ...data }} token={null} onRetry={vi.fn()} onDelete={vi.fn()} onViewerFailure={report}/></StrictMode>);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(phase === "ready" ? "Interactive repair model unavailable" : phaseLabels[phase]);
        expect(screen.getByRole("alert")).toHaveTextContent("Original provider failure");
        if (phase === "ready") expect(report).toHaveBeenCalledExactlyOnceWith("model_missing", undefined);
        else expect(report).not.toHaveBeenCalled();
        if (phase === "ready") expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
        else expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
      });
      it.each(["queued", "recognizing", "generating_model", "mapping", "cancelled"] as const)("does not report a premature or cancelled %s model failure", phase => {
        const report = vi.fn();
        render(<VisualRepairWorkspaceView data={{ phase, retryable: false, cacheHit: false, recommendations }} token={null} onRetry={vi.fn()} onDelete={vi.fn()} onViewerFailure={report}/>);
        expect(report).not.toHaveBeenCalled();
        expect(screen.queryByText("Required 3D model unavailable")).not.toBeInTheDocument();
      });
      it("reports invalid manifests once without crashing on empty steps", () => {
        const report = vi.fn();
        render(<StrictMode><ReadyRepair scene={scene} solution={{ ...solution, steps: [] }} recommendations={recommendations} token="owner-token" cacheHit={false} onViewerFailure={report}/></StrictMode>);
        expect(screen.getByRole("alert")).toHaveTextContent("missing its mapped model or instructions");
        expect(report).toHaveBeenCalledExactlyOnceWith("manifest_invalid", scene.id);
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
      });
      it("reports expired sessions once without fetching", () => {
        const report = vi.fn();
        render(<StrictMode><ReadyRepair scene={scene} solution={solution} token={null} cacheHit={false} onViewerFailure={report}/></StrictMode>);
        expect(report).toHaveBeenCalledExactlyOnceWith("session_expired", scene.id);
        expect(fetch).not.toHaveBeenCalled();
      });
      it("reports download failures with metadata only and allows a new report on explicit retry", async () => {
        const report = vi.fn();
        vi.mocked(fetch).mockRejectedValue(new Error("Sensitive provider payload should not be sent"));
        render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false} onViewerFailure={report}/>);
        expect(await screen.findByRole("alert")).toHaveTextContent("Sensitive provider payload should not be sent");
        expect(report).toHaveBeenCalledExactlyOnceWith("download_failed", scene.id);
        fireEvent.click(screen.getByRole("button", { name: "Retry 3D viewer" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Sensitive provider payload should not be sent");
        expect(report).toHaveBeenCalledTimes(2);
      });
      it("reports actual download timeouts only once even when abort rejects", async () => {
        vi.useFakeTimers();
        const report = vi.fn();
        vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }));
        render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false} onViewerFailure={report}/>);
        await act(async () => { await vi.advanceTimersByTimeAsync(45_001); });
        expect(screen.getByRole("alert")).toHaveTextContent("download timed out");
        expect(report).toHaveBeenCalledExactlyOnceWith("download_timeout", scene.id);
        await act(async () => { await vi.advanceTimersByTimeAsync(80_001); });
        expect(report).toHaveBeenCalledOnce();
      });
      it("reports a renderer readiness timeout while preserving advisory", async () => {
        vi.useFakeTimers();
        const report = vi.fn();
        render(<ReadyRepair scene={scene} solution={solution} recommendations={recommendations} token="owner-token" cacheHit={false} onViewerFailure={report}/>);
        await act(async () => { await vi.advanceTimersByTimeAsync(80_001); });
        expect(screen.getByRole("alert")).toHaveTextContent("viewer did not become ready");
        expect(report).toHaveBeenCalledExactlyOnceWith("render_timeout", scene.id);
        expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
        expect(screen.queryByText(solution.steps[0].description)).not.toBeInTheDocument();
      });
      it("deduplicates render errors per attempt and hides mapped repair content, not advisory", async () => {
        const report = vi.fn();
        render(<ReadyRepair scene={scene} solution={solution} recommendations={recommendations} token="owner-token" cacheHit={false} onViewerFailure={report}/>);
        await ready();
        const onError = calls.canvas.mock.lastCall![0].onError;
        act(() => { onError("WebGL context lost"); onError("WebGL context lost again"); });
        expect(report).toHaveBeenCalledExactlyOnceWith("render_failed", scene.id);
        expect(screen.getByRole("region", { name: "Repair recommendations" })).toBeInTheDocument();
        expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
      });
      it("reports errors caught by the model boundary", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const report = vi.fn();
        calls.canvas.mockImplementation(() => { throw new Error("Renderer initialization failed"); });
        render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false} onViewerFailure={report}/>);
        expect(await screen.findByRole("alert")).toHaveTextContent("3D view could not start");
        expect(report).toHaveBeenCalledExactlyOnceWith("render_failed", scene.id);
      });
      it("does not report download aborts on unmount", async () => {
        const report = vi.fn();
        vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }));
        const { unmount } = render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false} onViewerFailure={report}/>);
        await act(async () => { unmount(); });
        expect(report).not.toHaveBeenCalled();
      });
      it("submits owner-correlated metadata for a connected renderer failure without raw error text", async () => {
        calls.progress.mockReturnValue({ phase: "ready", retryable: false, cacheHit: false, recommendations, scene, solution });
        const { rerender } = render(<ProblemWorkspace id="problem-one"/>);
        await ready();
        await act(async () => calls.canvas.mock.lastCall?.[0].onError("Raw renderer details must stay local"));
        rerender(<ProblemWorkspace id="problem-one"/>);
        expect(calls.reportViewerFailure).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-one", sceneId: "scene-one", code: "render_failed" });
        expect(screen.getByRole("alert")).toHaveTextContent("Raw renderer details must stay local");
      });
      it("surfaces failed diagnostic delivery and clears the warning after viewer recovery", async () => {
        calls.progress.mockReturnValue({ phase: "ready", retryable: false, cacheHit: false, scene, solution });
        vi.mocked(fetch).mockRejectedValueOnce(new Error("The model download failed"));
        calls.reportViewerFailure.mockRejectedValue(new Error("Authentication is unavailable"));
        render(<ProblemWorkspace id="problem-one"/>);
        expect(await screen.findByText(/Diagnostic submission failed/)).toBeInTheDocument();
        expect(screen.getByText("The model download failed")).toBeInTheDocument();
        expect(calls.reportViewerFailure).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-one", sceneId: scene.id, code: "download_failed" });
        expect(screen.queryByText("Authentication is unavailable")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Retry 3D viewer" }));
        await ready();
        expect(screen.queryByText(/Diagnostic submission failed/)).not.toBeInTheDocument();
        expect(screen.getByText(solution.title)).toBeInTheDocument();
      });
      it("does not restore an old diagnostic warning if delivery fails after viewer recovery", async () => {
        calls.progress.mockReturnValue({ phase: "ready", retryable: false, cacheHit: false, scene, solution });
        let rejectReport!: (error: Error) => void;
        calls.reportViewerFailure.mockReturnValue(new Promise((_resolve, reject) => { rejectReport = reject; }));
        render(<ProblemWorkspace id="problem-one"/>);
        await ready();
        act(() => calls.canvas.mock.lastCall?.[0].onError("Renderer failed"));
        fireEvent.click(screen.getByRole("button", { name: "Retry 3D viewer" }));
        await ready();
        await act(async () => rejectReport(new Error("Delayed diagnostic delivery failure")));
        expect(screen.queryByText(/Diagnostic submission failed/)).not.toBeInTheDocument();
        expect(screen.getByText(solution.title)).toBeInTheDocument();
      });
    });
    it("withdraws all recommendations, recognition and sources when cancelled", () => {
      const { rerender } = render(<VisualRepairWorkspaceView data={{ phase: "mapping", retryable: false, cacheHit: false, recommendations }} token={null} onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.getByText("Example Hardware")).toBeInTheDocument();
      rerender(<VisualRepairWorkspaceView data={{ phase: "cancelled", message: "This repair was stopped.", retryable: false, cacheHit: false, recommendations, scene, solution }} token={null} onRetry={vi.fn()} onDelete={vi.fn()}/>);
      expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
      expect(screen.queryByText(recommendations.summary)).not.toBeInTheDocument();
      expect(screen.queryByText("Example Hardware")).not.toBeInTheDocument();
      expect(screen.queryByText("example/vision-model")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Handle documentation" })).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("This repair was stopped.");
      expect(fetch).not.toHaveBeenCalled();
    });
    it("does not fabricate recognition and omits unsafe recommendation URLs before and after 3D readiness", async () => {
      render(<ReadyRepair scene={scene} solution={solution} token="owner-token" cacheHit={false} recommendations={{ ...recommendations, identification: undefined, visionModel: undefined, sources: [...recommendations.sources, { title: "Unsafe script", url: "javascript:alert(1)" }, { title: "Insecure link", url: "http://example.com" }, { title: "Credential link", url: "https://user:pass@example.com" }] }}/>);
      expect(screen.getByRole("link", { name: "Handle documentation" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Unsafe script|Insecure link|Credential link/ })).not.toBeInTheDocument();
      await ready();
      expect(screen.queryByRole("heading", { name: "Tentative object identification" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Image recognition via OpenRouter/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Unsafe script|Insecure link|Credential link/ })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Handle documentation" })).toBeInTheDocument();
    });
    it("preserves failure feedback and legacy referral safety guidance when recommendations are absent", () => {
      render(<PipelineProgress data={{ phase: "referral", message: "Recognition failed; the object could not be confirmed.", retryable: false, cacheHit: false }} delayed={false} busy={false} onRetry={vi.fn()}/>);
      expect(screen.getByRole("alert")).toHaveTextContent("Recognition failed");
      expect(screen.getByText(/Stop work. Do not attempt hazardous disassembly/)).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Image recognition via OpenRouter/)).not.toBeInTheDocument();
    });
  });
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
  it("persists a mismatched-object stop and stays locked even if cancellation fails", async () => {
    calls.progress.mockReturnValue({ phase: "ready", retryable: false, cacheHit: false, scene, solution, recommendations });
    calls.cancel.mockRejectedValue(new Error("Connection interrupted"));
    render(<ProblemWorkspace id="problem-one"/>);
    await ready();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Pause — object or model/ })));
    expect(calls.cancel).toHaveBeenCalledExactlyOnceWith({ problemId: "problem-one" });
    expect(screen.queryByText(solution.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Repair recommendations" })).not.toBeInTheDocument();
    expect(screen.queryByText(recommendations.identification!.product)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume viewing" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("stopping the saved run failed");
    act(() => calls.canvas.mock.lastCall?.[0].onError("WebGL context lost"));
    expect(screen.getByRole("button", { name: "Retry 3D viewer" })).toBeDisabled();
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
