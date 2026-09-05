import { inspectGlb } from "./glb";
import type { Mapping } from "./repairContracts";

type GeometryDocument = {
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  nodes: { name?: string; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }[];
};
const identityMatrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: number[], b: number[]) {
  const result = Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) {
    result[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  }
  return result;
}
function localMatrix(node: GeometryDocument["nodes"][number]) {
  for (const [value, length] of [[node.matrix, 16], [node.translation, 3], [node.rotation, 4], [node.scale, 3]] as const) {
    if (value && (value.length !== length || value.some(n => !Number.isFinite(n) || Math.abs(n) > 1_000_000))) throw new Error("Invalid model transform.");
  }
  if (node.matrix) {
    if (node.translation || node.rotation || node.scale || node.matrix[3] !== 0 || node.matrix[7] !== 0 || node.matrix[11] !== 0 || node.matrix[15] !== 1) throw new Error("Invalid affine mesh transform.");
    return node.matrix;
  }
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  if (Math.abs(x * x + y * y + z * z + w * w - 1) > 0.001) throw new Error("Invalid mesh rotation.");
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function inspectRepairGeometry(bytes: Uint8Array, mapping: Mapping) {
  const inspected = inspectGlb(bytes);
  if (!inspected.mappingReady) throw new Error("The model requires distinct named visible mesh nodes.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonSize = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonSize)).trim()) as GeometryDocument;
  const binaryStart = 28 + jsonSize;
  const boxes = new Map<string, { min: number[]; max: number[] }>();
  const parents = new Map<number, number>();
  doc.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      if (parents.has(child)) throw new Error("Ambiguous mesh parent hierarchy.");
      parents.set(child, index);
    }
  });
  const worlds = new Map<number, number[]>();
  function world(index: number): number[] {
    const existing = worlds.get(index);
    if (existing) return existing;
    const parent = parents.get(index);
    const transform = multiply(parent === undefined ? identityMatrix() : world(parent), localMatrix(doc.nodes[index]));
    worlds.set(index, transform);
    return transform;
  }
  for (const [nodeIndex, node] of doc.nodes.entries()) {
    const transform = world(nodeIndex);
    if (transform.some(n => !Number.isFinite(n) || Math.abs(n) > 1_000_000) || Math.abs(
      transform[0] * (transform[5] * transform[10] - transform[6] * transform[9]) -
      transform[4] * (transform[1] * transform[10] - transform[2] * transform[9]) +
      transform[8] * (transform[1] * transform[6] - transform[2] * transform[5])
    ) < 1e-12) throw new Error("Collapsed or excessive world-space mesh transform.");
    if (node.mesh === undefined || !node.name) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let hasArea = false;
    for (const primitive of doc.meshes[node.mesh].primitives) {
      const accessor = doc.accessors[primitive.attributes.POSITION];
      if (accessor.componentType !== 5126 || accessor.type !== "VEC3") throw new Error("Mapping requires standard floating-point vertex positions.");
      const buffer = doc.bufferViews[accessor.bufferView];
      const offset = binaryStart + (buffer.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const stride = buffer.byteStride ?? 12;
      const position = (i: number) => {
        if (i >= accessor.count) throw new Error("Triangle index exceeds vertex data.");
        const [x, y, z] = [0, 1, 2].map(axis => view.getFloat32(offset + i * stride + axis * 4, true));
        return [0, 1, 2].map(axis => transform[axis] * x + transform[axis + 4] * y + transform[axis + 8] * z + transform[axis + 12]);
      };
      for (let i = 0; i < accessor.count; i++) {
        const p = position(i);
        for (let axis = 0; axis < 3; axis++) {
          const n = p[axis];
          if (!Number.isFinite(n) || Math.abs(n) > 1_000_000) throw new Error("Invalid or unbounded mesh positions.");
          min[axis] = Math.min(min[axis], n); max[axis] = Math.max(max[axis], n);
        }
      }
      const indices = primitive.indices === undefined ? null : doc.accessors[primitive.indices];
      const indexBuffer = indices ? doc.bufferViews[indices.bufferView] : null;
      const componentBytes = indices?.componentType === 5121 ? 1 : indices?.componentType === 5123 ? 2 : 4;
      const vertex = (i: number) => {
        if (!indices || !indexBuffer) return i;
        const at = binaryStart + (indexBuffer.byteOffset ?? 0) + (indices.byteOffset ?? 0) + i * (indexBuffer.byteStride ?? componentBytes);
        return componentBytes === 1 ? view.getUint8(at) : componentBytes === 2 ? view.getUint16(at, true) : view.getUint32(at, true);
      };
      for (let i = 0; i < (indices?.count ?? accessor.count); i += 3) {
        const a = position(vertex(i)), b = position(vertex(i + 1)), c = position(vertex(i + 2));
        const u = b.map((n, axis) => n - a[axis]), w = c.map((n, axis) => n - a[axis]);
        const area = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
        if (area > 1e-12) hasArea = true;
      }
    }
    const extents = max.map((n, axis) => n - min[axis]);
    if (!hasArea || extents.filter(n => n > 1e-8).length < 2 || Math.max(...extents) > 10_000) throw new Error("Empty, collapsed, or unreasonably scaled geometry.");
    boxes.set(node.name, { min, max });
  }
  const meshAssignments = new Map<number, string>();
  for (const part of mapping.parts) for (const name of part.nodeNames) {
    const node = doc.nodes.find(n => n.name === name);
    if (!boxes.has(name) || node?.mesh === undefined) throw new Error("Mapped component lacks finite visible bounds.");
    // Repeated instances of one fused mesh cannot stand in for different mechanical parts.
    const assigned = meshAssignments.get(node.mesh);
    if (assigned && assigned !== part.id) throw new Error("Different components share the same mesh geometry.");
    meshAssignments.set(node.mesh, part.id);
  }
  return inspected;
}
