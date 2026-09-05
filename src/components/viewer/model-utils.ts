import { Box3, Mesh, Object3D, Vector3 } from "three";
import type { AssemblyPart } from "@/lib/domain";

export type Position = readonly [number, number, number];

export function combinedPartBounds(root: Object3D, ids: readonly string[]): Box3 {
  root.updateWorldMatrix(true, true);
  const box = new Box3();
  for (const id of ids) {
    const part = new Box3();
    root.traverse(node => {
      if (node.userData.viewerPartId === id) part.expandByObject(node);
    });
    if (part.isEmpty() || ![...part.min.toArray(), ...part.max.toArray()].every(Number.isFinite) || part.getSize(new Vector3()).lengthSq() === 0) {
      throw new Error("A step target has no usable 3D bounds. Instructions remain locked.");
    }
    box.union(part);
  }
  if (box.isEmpty()) throw new Error("No model targets were supplied for this step.");
  return box;
}

/** GLTFLoader sanitizes names for animation tracks; reviewed labels reference the original GLB. */
export function restoreSourceNodeNames(
  root: Object3D,
  sourceIndex: (node: Object3D) => number | undefined,
  sourceNodes: readonly { name?: unknown }[],
): void {
  root.traverse((node) => {
    const index = sourceIndex(node);
    const name = index === undefined ? undefined : sourceNodes[index]?.name;
    if (typeof name === "string") node.name = name;
  });
}

export function explodedPosition(base: Position, offset: Position, amount: number): [number, number, number] {
  return [base[0] + offset[0] * amount, base[1] + offset[1] * amount, base[2] + offset[2] * amount];
}

/** Resolve every matching node, not only the first mesh returned by getObjectByName. */
export function resolvePartNodes(root: Object3D, parts: AssemblyPart[]): Map<string, Object3D[]> {
  const result = new Map<string, Object3D[]>();
  const owner = new Map<Object3D, string>();
  const ids = new Set<string>();
  if (!parts.length) throw new Error("This assembly has no part labels. Add part mappings before inspecting the model.");
  for (const part of parts) {
    if (!part.id || ids.has(part.id)) throw new Error("Part IDs must be present and unique.");
    ids.add(part.id);
    if (!part.label.trim() || !part.nodeNames.length) throw new Error(`Part ${part.id} is missing its label or node mapping.`);
    if (part.explodeOffset.length !== 3 || !part.explodeOffset.every(Number.isFinite)) throw new Error(`Part ${part.label} has an invalid explode offset.`);
    const nodes = new Set<Object3D>();
    for (const name of part.nodeNames) {
      let found = false;
      root.traverse((node) => {
        if (node.name === name) {
          nodes.add(node);
          found = true;
        }
      });
      if (!found) throw new Error(`The model is missing the node “${name}” for ${part.label}.`);
    }
    // A part can map a group and its children; moving both would double the offset.
    const roots = [...nodes].filter((node) => {
      for (let parent = node.parent; parent; parent = parent.parent) if (nodes.has(parent)) return false;
      return true;
    });
    let hasMesh = false;
    for (const node of roots) {
      node.traverse((child) => {
        if (child instanceof Mesh) hasMesh = true;
        const existing = owner.get(child);
        if (existing && existing !== part.id) throw new Error("Part mappings overlap. Each mesh must belong to one part.");
        owner.set(child, part.id);
      });
    }
    if (!hasMesh) throw new Error(`The mapped part ${part.label} has no displayable meshes.`);
    result.set(part.id, roots);
  }
  return result;
}

export function capturePositions(nodes: Map<string, Object3D[]>): Map<Object3D, Vector3> {
  const positions = new Map<Object3D, Vector3>();
  for (const group of nodes.values()) for (const node of group) positions.set(node, node.position.clone());
  return positions;
}

/** Offsets are always applied to original transforms, so repeated toggles never drift. */
export function applyExplode(
  nodes: Map<string, Object3D[]>,
  originals: Map<Object3D, Vector3>,
  parts: AssemblyPart[],
  amount: number,
): void {
  for (const part of parts) {
    for (const node of nodes.get(part.id) ?? []) {
      const base = originals.get(node);
      if (base) node.position.set(...explodedPosition(base.toArray(), part.explodeOffset, amount));
    }
  }
}

export const MAX_GLB_BYTES = 10 * 1024 * 1024;

/** Reject URI-bearing GLBs before GLTFLoader can issue a secondary request. */
export function validateSelfContainedGlb(buffer: ArrayBuffer): void {
  if (buffer.byteLength > MAX_GLB_BYTES) throw new Error("The model exceeds the 10 MB viewer limit.");
  if (buffer.byteLength < 20) throw new Error("The model is not a valid binary GLB.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error("The model is not a supported GLB 2.0 file.");
  }
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error("The model is missing its GLB metadata.");
  const length = view.getUint32(12, true);
  if (length > buffer.byteLength - 20) throw new Error("The model metadata is incomplete.");
  let metadata: unknown;
  try {
    metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  } catch {
    throw new Error("The model metadata could not be read.");
  }
  function inspect(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if ((key.toLowerCase() === "uri" || key.toLowerCase() === "url") && typeof nested === "string") {
        throw new Error("This model references an external resource. Upload a self-contained GLB with embedded textures.");
      }
      inspect(nested);
    }
  }
  inspect(metadata);
}
