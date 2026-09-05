import { describe, expect, it } from "vitest";
import { safeSourceUrl, validateRepairManifest, type RepairSceneManifest, type RepairSolution } from "./visual-repair";

const scene: RepairSceneManifest = { id: "private", source: "reference", parts: [{ id: "visible", label: "Visible component", description: "Mapped external part", nodeNames: ["visible-mesh"], explodeOffset: [0, 0, 0] }] };
const solution: RepairSolution = {
  title: "Inspect the visible component", summary: "A private draft", prerequisites: [], stopConditions: [],
  steps: [{ id: "inspect", title: "Inspect", description: "Compare the visible part", partIds: ["visible"], sourceIds: ["manual"] }],
  sources: [{ id: "manual", title: "Manual", url: "https://example.org/manual" }],
};
describe("private readiness manifest", () => {
  it("converts checked offsets without marking a private draft as publicly reviewed", () => {
    const parts = validateRepairManifest(scene, solution);
    expect(parts[0].explodeOffset).toEqual([0, 0, 0]);
    expect(parts[0]).not.toHaveProperty("reviewed");
  });
  it("requires valid coordinates, unique part IDs and non-overlapping node names", () => {
    expect(() => validateRepairManifest({ ...scene, parts: [{ ...scene.parts[0], explodeOffset: [0, NaN, 0] }] }, solution)).toThrow("coordinates");
    expect(() => validateRepairManifest({ ...scene, parts: [scene.parts[0], scene.parts[0]] }, solution)).toThrow("overlapping");
    expect(() => validateRepairManifest({ ...scene, parts: [scene.parts[0], { ...scene.parts[0], id: "other" }] }, solution)).toThrow("overlapping");
  });
  it("requires each instruction to resolve to model parts and safe supporting source links", () => {
    expect(() => validateRepairManifest(scene, { ...solution, sources: [] })).toThrow("supporting source");
    expect(() => validateRepairManifest(scene, { ...solution, sources: [{ ...solution.sources[0], url: "javascript:alert(1)" }] })).toThrow("supporting source");
    expect(() => validateRepairManifest(scene, { ...solution, steps: [{ ...solution.steps[0], partIds: [] }] })).toThrow("model target");
  });
  it("does not turn unsafe source URLs into executable links", () => {
    expect(safeSourceUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeSourceUrl("https://user:secret@example.org")).toBeUndefined();
    expect(safeSourceUrl("https://example.org/manual")).toBe("https://example.org/manual");
  });
});
