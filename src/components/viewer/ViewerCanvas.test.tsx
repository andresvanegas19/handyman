import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PrivateMappedScene } from "@/lib/visual-repair";
import { PrivateMappedCanvas } from "./ViewerCanvas";

// Fiber mounts fallback in the DOM canvas even when the separate Three renderer succeeds.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ fallback }: { fallback?: ReactNode }) => <canvas data-testid="fiber-canvas">{fallback}</canvas>,
  useThree: vi.fn(),
}));
vi.mock("@react-three/drei", () => ({
  Bounds: () => null, ContactShadows: () => null, Html: () => null, OrbitControls: () => null,
  useBounds: vi.fn(),
}));

const scene: PrivateMappedScene = {
  kind: "private-mapped", url: "blob:private-model",
  parts: [{ id: "handle", label: "Handle", description: "Visible handle", nodeNames: ["Handle"], explodeOffset: [0, 0, 0] }],
};
const originalContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
const getContext = vi.fn();
const loseContext = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: getContext });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  getContext.mockReturnValue({ getExtension: () => ({ loseContext }) });
});
afterEach(() => {
  cleanup();
  if (originalContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalContext);
  vi.unstubAllGlobals();
});

describe("private canvas availability and inert Fiber fallback", () => {
  it("does not report an error just because fallback DOM mounts with a working WebGL canvas", () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    render(<PrivateMappedCanvas scene={scene} activePartIds={[]} focusIds={[]} focusKey={0} onError={onError} onReady={onReady}/>);
    expect(getContext).toHaveBeenCalledExactlyOnceWith("webgl2");
    expect(loseContext).toHaveBeenCalledOnce();
    expect(screen.getByTestId("fiber-canvas")).toContainElement(screen.getByText("WebGL is unavailable. Instructions remain locked."));
    expect(onError).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("reports a failed WebGL probe without mounting Fiber or unlocking instructions", () => {
    getContext.mockReturnValue(null);
    const onError = vi.fn();
    const onReady = vi.fn();
    render(<PrivateMappedCanvas scene={scene} activePartIds={[]} focusIds={[]} focusKey={0} onError={onError} onReady={onReady}/>);
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Instructions remain locked"));
    expect(screen.queryByTestId("fiber-canvas")).not.toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
    expect(loseContext).not.toHaveBeenCalled();
  });

  it("handles a browser that throws while obtaining its WebGL context", () => {
    getContext.mockImplementation(() => { throw new Error("Graphics disabled"); });
    const onError = vi.fn();
    const onReady = vi.fn();
    render(<PrivateMappedCanvas scene={scene} activePartIds={[]} focusIds={[]} focusKey={0} onError={onError} onReady={onReady}/>);
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("WebGL is unavailable"));
    expect(screen.queryByTestId("fiber-canvas")).not.toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });
});
