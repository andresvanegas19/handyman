import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "../../../convex/_generated/dataModel";
import RepairScene from "./repair-scene";

const { getScene, requestScene, getToken } = vi.hoisted(() => ({
  getScene: vi.fn(), requestScene: vi.fn(), getToken: vi.fn(),
}));
vi.mock("convex/react", () => ({ useQuery: () => getScene(), useMutation: () => requestScene }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => getToken() }));
vi.mock("next/dynamic", () => ({ default: () => function MockCanvas() { return <div>Generated scene canvas</div>; } }));
const problemId = "problem-one" as Id<"problems">;
const photos = [
  { _id: "photo-one" as Id<"media">, kind: "photo" as const, state: "ready" as const },
  { _id: "photo-two" as Id<"media">, kind: "photo" as const, state: "ready" as const },
];
beforeEach(() => {
  getScene.mockReset().mockReturnValue({ eligible: true, configured: true, scene: null });
  requestScene.mockReset().mockResolvedValue("scene-one");
  getToken.mockReset().mockReturnValue("test-session");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://sample.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:private-scene") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("repair scene workflow", () => {
  it("requires explicit consent and sends only the chosen photo", async () => {
    render(<RepairScene problemId={problemId} photos={photos}/>);
    const generate = screen.getByRole("button", { name: "Generate 3D with Tripo" });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Source photo"), { target: { value: "photo-two" } });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(generate);
    await waitFor(() => expect(requestScene).toHaveBeenCalledWith({ problemId, photoId: photos[1]._id, consent: true }));
  });
  it("hides generation for unsafe or uncertain analyses", () => {
    getScene.mockReturnValue({ eligible: false, configured: true, scene: null });
    render(<RepairScene problemId={problemId} photos={photos}/>);
    expect(screen.getByText(/locked until analysis/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate/ })).not.toBeInTheDocument();
  });
  it("explains missing configuration and does not offer fake output", () => {
    getScene.mockReturnValue({ eligible: true, configured: false, scene: null });
    render(<RepairScene problemId={problemId} photos={photos}/>);
    expect(screen.getByText(/3D generation is not configured/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Generate 3D with Tripo" })).toBeDisabled();
    expect(screen.queryByText("Generated scene canvas")).not.toBeInTheDocument();
  });
  it("shows saved progress rather than offering duplicate submissions", () => {
    getScene.mockReturnValue({ eligible: true, configured: true, scene: { _id: "scene", state: "running", ready: false } });
    render(<RepairScene problemId={problemId} photos={photos}/>);
    expect(screen.getByRole("status")).toHaveTextContent("progress is saved");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("shows provider errors and warns about duplicate charges before retry", () => {
    getScene.mockReturnValue({ eligible: true, configured: true, scene: { _id: "scene", state: "failed", ready: false, failure: "Submission failed." } });
    render(<RepairScene problemId={problemId} photos={photos}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("avoid duplicate charges");
    expect(screen.getByRole("button", { name: "Retry Tripo generation" })).toBeDisabled();
  });
  it("downloads a private GLB only on demand and revokes its preview on close", async () => {
    getScene.mockReturnValue({ eligible: true, configured: true, scene: { _id: "scene-one", state: "succeeded", ready: true } });
    const fetch = vi.fn().mockResolvedValue(new Response(new Blob(["glb-fixture"])));
    vi.stubGlobal("fetch", fetch);
    render(<RepairScene problemId={problemId} photos={photos}/>);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open private 3D model" }));
    const download = await screen.findByRole("link", { name: "Download GLB for Blender" });
    expect(download).toHaveAttribute("href", "blob:private-scene");
    expect(download).toHaveAttribute("download", "repair-context.glb");
    expect(fetch.mock.calls[0][0].toString()).toBe("https://sample.convex.site/scene?id=scene-one");
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer test-session" }, cache: "no-store" });
    expect(screen.getByRole("note")).toHaveTextContent("Unreviewed Tripo output");
    fireEvent.click(screen.getByRole("button", { name: "Close model" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-scene");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("reports private delivery failure without displaying substitute geometry", async () => {
    getScene.mockReturnValue({ eligible: true, configured: true, scene: { _id: "scene-one", state: "succeeded", ready: true } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    render(<RepairScene problemId={problemId} photos={photos}/>);
    fireEvent.click(screen.getByRole("button", { name: "Open private 3D model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("private scene is unavailable");
    expect(screen.queryByText("Generated scene canvas")).not.toBeInTheDocument();
  });
  it("revokes a loaded scene when its safety eligibility is invalidated", async () => {
    getScene.mockReturnValue({ eligible: true, configured: true, scene: { _id: "scene-one", state: "succeeded", ready: true } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["glb-fixture"]))));
    const { rerender } = render(<RepairScene problemId={problemId} photos={photos}/>);
    fireEvent.click(screen.getByRole("button", { name: "Open private 3D model" }));
    await screen.findByRole("link", { name: "Download GLB for Blender" });
    getScene.mockReturnValue({ eligible: false, configured: true, scene: null });
    rerender(<RepairScene problemId={problemId} photos={photos}/>);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-scene");
    expect(screen.queryByText("Generated scene canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("drops private blob access when the browser session expires", async () => {
    getScene.mockReturnValue({ eligible: true, configured: true, scene: { _id: "scene-one", state: "succeeded", ready: true } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["glb-fixture"]))));
    const { rerender } = render(<RepairScene problemId={problemId} photos={photos}/>);
    fireEvent.click(screen.getByRole("button", { name: "Open private 3D model" }));
    await screen.findByRole("link", { name: "Download GLB for Blender" });
    getToken.mockReturnValue(null);
    rerender(<RepairScene problemId={problemId} photos={photos}/>);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-scene");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
