import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import SceneCanvas from "./SceneCanvas";

const calls = vi.hoisted(() => ({ load: vi.fn(), finish: vi.fn(), available: vi.fn() }));
vi.mock("./ViewerCanvas", () => ({
  loadModel: calls.load, finishModel: calls.finish, useWebGLAvailable: calls.available,
  ContextLossHandler: () => null,
}));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="fiber-canvas">{children}</div>,
}));
vi.mock("@react-three/drei", () => ({
  Bounds: ({ children }: { children: ReactNode }) => children,
  Center: ({ children }: { children: ReactNode }) => children,
  OrbitControls: () => null,
}));
beforeEach(() => { vi.resetAllMocks(); calls.available.mockReturnValue(true); });
afterEach(cleanup);

describe("real generated scene previews", () => {
  it("reports readiness only after usable geometry mounts, and disposes it on removal", async () => {
    const model = new Group().add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    calls.load.mockResolvedValue(model);
    const onReady = vi.fn();
    const onError = vi.fn();
    const { unmount } = render(<SceneCanvas url="blob:private" onReady={onReady} onError={onError} fill/>);
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(calls.load).toHaveBeenCalledWith("blob:private", expect.any(AbortSignal), true);
    expect(onError).not.toHaveBeenCalled();
    unmount();
    expect(calls.finish).toHaveBeenCalledWith(model);
  });
  it("rejects an empty model rather than displaying substitute geometry", async () => {
    const model = new Group();
    calls.load.mockResolvedValue(model);
    const onReady = vi.fn();
    const onError = vi.fn();
    const { unmount } = render(<SceneCanvas url="blob:empty" onReady={onReady} onError={onError}/>);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("The generated model has no usable visible geometry."));
    expect(screen.queryByTestId("fiber-canvas")).not.toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
    unmount();
    expect(calls.finish).toHaveBeenCalledWith(model);
  });
  it("does not report ready without an available WebGL renderer", async () => {
    calls.available.mockReturnValue(false);
    calls.load.mockResolvedValue(new Group().add(new Mesh(new BoxGeometry(), new MeshBasicMaterial())));
    const onReady = vi.fn();
    render(<SceneCanvas url="blob:private" onReady={onReady} onError={vi.fn()}/>);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByTestId("fiber-canvas")).not.toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });
});
