import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh } from "three";
import type { AssemblyPart } from "@/lib/domain";
import { STARTER_GUIDES } from "@/lib/catalog";
import { PREVIEW_PARTS } from "./parts";
import { applyExplode, capturePositions, combinedPartBounds, explodedPosition, resolvePartNodes, restoreSourceNodeNames, validateSelfContainedGlb } from "./model-utils";

const part: AssemblyPart = { id: "screws", label: "Screws", description: "Two fixing meshes", nodeNames: ["screw"], explodeOffset: [1, 2, -3] };

describe("automatic step camera targets", () => {
  it("combines every active part in world space after parent transforms", () => {
    const root = new Group();
    root.position.set(10, 2, 0);
    root.scale.setScalar(2);
    const first = new Mesh(new BoxGeometry(1, 1, 1));
    const second = new Mesh(new BoxGeometry(1, 1, 1));
    first.userData.viewerPartId = "first";
    second.userData.viewerPartId = "second";
    second.position.x = 3;
    root.add(first, second);
    const box = combinedPartBounds(root, ["first", "second"]);
    expect(box.min.toArray()).toEqual([9, 1, -1]);
    expect(box.max.toArray()).toEqual([17, 3, 1]);
    expect(combinedPartBounds(root, ["first"]).max.x).toBe(11);
    first.geometry.dispose(); second.geometry.dispose();
  });
  it("rejects missing and empty targets instead of silently focusing the entire object", () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.userData.viewerPartId = "known";
    root.add(mesh);
    expect(() => combinedPartBounds(root, ["known", "missing"])).toThrow("no usable 3D bounds");
    expect(() => combinedPartBounds(root, [])).toThrow("No model targets");
    mesh.geometry.dispose();
  });
});

function makeGlb(metadata: unknown) {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const length = Math.ceil(json.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).fill(32);
  new Uint8Array(buffer, 20).set(json);
  return buffer;
}

describe("reviewed part mapping", () => {
  it("restores source names sanitized or deduplicated by GLTFLoader", () => {
    const root = new Group();
    const first = new Mesh();
    const second = new Mesh();
    first.name = "screw_head";
    second.name = "screw_head_1";
    root.add(first, second);
    const indices = new Map([[first, 0], [second, 1]]);
    restoreSourceNodeNames(root, (node) => indices.get(node as Mesh), [{ name: "screw head" }, { name: "screw head" }]);
    const result = resolvePartNodes(root, [{ ...part, nodeNames: ["screw head"] }]);
    expect(result.get("screws")).toEqual([first, second]);
  });

  it("matches every mesh sharing a reviewed node name", () => {
    const root = new Group();
    const first = new Mesh();
    const second = new Mesh();
    first.name = second.name = "screw";
    root.add(first, second);
    expect(resolvePartNodes(root, [part]).get("screws")).toEqual([first, second]);
  });

  it("validates every node mapping rather than accepting a partial match", () => {
    const root = new Mesh();
    root.name = "screw";
    expect(() => resolvePartNodes(root, [{ ...part, nodeNames: ["screw", "missing"] }])).toThrow("missing");
    expect(() => resolvePartNodes(root, [part, part])).toThrow("unique");
    expect(() => resolvePartNodes(root, [])).toThrow("no part labels");
  });

  it("does not apply an offset twice when both a group and its child are mapped", () => {
    const root = new Group();
    root.name = "fixings";
    const mesh = new Mesh();
    mesh.name = "screw";
    root.add(mesh);
    expect(resolvePartNodes(root, [{ ...part, nodeNames: ["fixings", "screw"] }]).get("screws")).toEqual([root]);
  });

  it("rejects overlapping semantic parts", () => {
    const root = new Group();
    root.name = "fixings";
    const mesh = new Mesh();
    mesh.name = "screw";
    root.add(mesh);
    expect(() => resolvePartNodes(root, [part, { ...part, id: "other", nodeNames: ["fixings"] }])).toThrow("overlap");
  });

  it("rejects labels that point to empty groups", () => {
    const root = new Group();
    root.name = "screw";
    expect(() => resolvePartNodes(root, [part])).toThrow("no displayable meshes");
  });
});

describe("reversible exploded transforms", () => {
  it("calculates from an immutable base, including zero and partial offsets", () => {
    const base = [1, 2, 3] as const;
    expect(explodedPosition(base, [2, -2, 4], 0.5)).toEqual([2, 1, 5]);
    expect(explodedPosition(base, [2, -2, 4], 0)).toEqual([1, 2, 3]);
    expect(base).toEqual([1, 2, 3]);
  });

  it("resets every mesh without drift after repeated explode calls", () => {
    const root = new Group();
    const first = new Mesh();
    const second = new Mesh();
    first.name = second.name = "screw";
    first.position.set(3, 5, 8);
    second.position.set(-1, -2, -3);
    root.add(first, second);
    const mapping = resolvePartNodes(root, [part]);
    const original = capturePositions(mapping);
    for (let iteration = 0; iteration < 50; iteration++) applyExplode(mapping, original, [part], 1);
    expect(first.position.toArray()).toEqual([4, 7, 5]);
    expect(second.position.toArray()).toEqual([0, 0, -6]);
    applyExplode(mapping, original, [part], 0);
    expect(first.position.toArray()).toEqual([3, 5, 8]);
    expect(second.position.toArray()).toEqual([-1, -2, -3]);
  });
});

describe("self-contained GLB validation", () => {
  it("accepts embedded binary buffers and images", () => {
    expect(() => validateSelfContainedGlb(makeGlb({ asset: { version: "2.0" }, buffers: [{ byteLength: 100 }], images: [{ bufferView: 0, mimeType: "image/png" }] }))).not.toThrow();
  });

  it.each(["https://untrusted.invalid/image.png", "../texture.png", "data:image/png;base64,abc", "blob:untrusted"])("rejects URI-bearing GLBs before parsing: %s", (uri) => {
    expect(() => validateSelfContainedGlb(makeGlb({ images: [{ uri }] }))).toThrow("external resource");
  });

  it("rejects nested extension URLs and truncated files", () => {
    expect(() => validateSelfContainedGlb(makeGlb({ extensions: { vendor: { url: "https://untrusted.invalid" } } }))).toThrow("external resource");
    expect(() => validateSelfContainedGlb(new ArrayBuffer(4))).toThrow("valid binary GLB");
    const glb = makeGlb({ asset: { version: "2.0" } });
    new DataView(glb).setUint32(12, 99999, true);
    expect(() => validateSelfContainedGlb(glb)).toThrow("incomplete");
  });
});

describe("starter catalog drafts", () => {
  it("contains six distinct, unreviewed drafts with complete safety context", () => {
    expect(STARTER_GUIDES).toHaveLength(6);
    expect(new Set(STARTER_GUIDES.map((guide) => guide.slug)).size).toBe(6);
    for (const guide of STARTER_GUIDES) {
      expect(guide.status).toBe("draft");
      expect(guide.prerequisites.join(" ")).toContain("Unreviewed draft");
      expect(guide.stopConditions.length).toBeGreaterThanOrEqual(3);
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of guide.steps) {
        for (const id of step.partIds) {
          expect(guide.assemblyKind && PREVIEW_PARTS[guide.assemblyKind].some((part) => part.id === id)).toBe(true);
        }
      }
    }
  });
});
