import { useSyncExternalStore } from "react";

export const readyResult = {
  phase: "ready",
  retryable: false,
  cacheHit: true,
  solution: {
    title: "Inspect the cabinet handle",
    summary: "An illustrative, source-linked fixture for browser interaction only.",
    prerequisites: ["The cabinet is stable and unloaded."],
    stopConditions: ["Stop if the object does not match."],
    steps: [
      { id: "inspect-handle", title: "Look at the handle", description: "Locate the highlighted visible handle without applying force.", partIds: ["handle"], sourceIds: ["source-1"] },
      { id: "inspect-panel", title: "Look at the panel", description: "Locate the highlighted visible panel without disassembly.", partIds: ["panel"], sourceIds: ["source-1"] },
    ],
    sources: [{ id: "source-1", url: "https://example.com/manual", title: "Reference fixture" }],
  },
  scene: {
    id: "scene-fixture",
    source: "reference",
    parts: [
      { id: "handle", label: "Handle", description: "Visible handle", nodeNames: ["handle"], explodeOffset: [0, 0, 0] },
      { id: "panel", label: "Panel", description: "Visible cabinet panel", nodeNames: ["panel"], explodeOffset: [0, 0, 0] },
    ],
  },
};

type FixtureResult = typeof readyResult | { phase: string; retryable: boolean; cacheHit: boolean; message?: string };
type FixtureState = { result: FixtureResult; token: string | null; calls: { name: string; args: Record<string, unknown> }[] };
const listeners = new Set<() => void>();
let state: FixtureState = {
  result: { phase: "researching", retryable: false, cacheHit: false },
  token: "local-browser-fixture-token",
  calls: [],
};

export function setFixture(update: Partial<FixtureState>) {
  state = { ...state, ...update };
  listeners.forEach(listener => listener());
}

export function recordCall(name: string, args: Record<string, unknown>) {
  setFixture({ calls: [...state.calls, { name, args }] });
}

export function useFixture() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
  );
}

declare global {
  interface Window {
    visualFixture: {
      ready: () => void;
      phase: (phase: string, message?: string) => void;
      expireSession: () => void;
      calls: () => FixtureState["calls"];
    };
  }
}

window.visualFixture = {
  ready: () => setFixture({ result: readyResult }),
  phase: (phase, message) => setFixture({ result: { phase, message, retryable: phase === "failed", cacheHit: false } }),
  expireSession: () => setFixture({ token: null }),
  calls: () => state.calls,
};
