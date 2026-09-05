import { z } from "zod";

const integer = z.number().int().nonnegative();
const documentSchema = z.object({
  asset: z.object({ version: z.literal("2.0") }),
  buffers: z.array(z.object({ uri: z.string().optional(), byteLength: integer })),
  bufferViews: z.array(z.object({ buffer: integer, byteOffset: integer.optional(), byteLength: integer, byteStride: integer.optional() })).optional(),
  images: z.array(z.object({ uri: z.string().optional(), bufferView: integer.optional() })).optional(),
  accessors: z.array(z.object({
    count: z.number().int().min(1).max(450_000), bufferView: integer, byteOffset: integer.optional(),
    componentType: z.union([z.literal(5120), z.literal(5121), z.literal(5122), z.literal(5123), z.literal(5125), z.literal(5126)]),
    type: z.enum(["SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"]),
  })),
  meshes: z.array(z.object({ primitives: z.array(z.object({
    mode: integer.optional(), indices: integer.optional(), attributes: z.record(z.string(), integer),
  })).min(1) })).min(1),
  nodes: z.array(z.object({ name: z.string().optional(), mesh: integer.optional(), children: z.array(integer).optional() })),
  scenes: z.array(z.object({ nodes: z.array(integer) })).min(1),
  scene: integer.optional(),
  extensionsUsed: z.array(z.string()).optional(),
});
export function inspectGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 28 || bytes.byteLength > 10 * 1024 * 1024) throw new Error("GLB must be between 28 bytes and 10 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error("Invalid GLB header.");
  const jsonSize = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonSize % 4 || jsonSize + 28 > bytes.byteLength) throw new Error("GLB requires embedded JSON and binary chunks.");
  const binaryOffset = 20 + jsonSize;
  const binarySize = view.getUint32(binaryOffset, true);
  if (view.getUint32(binaryOffset + 4, true) !== 0x004e4942 || binaryOffset + 8 + binarySize !== bytes.byteLength) throw new Error("Invalid GLB binary chunk.");
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, binaryOffset)).trim());
  const doc = documentSchema.parse(parsed);
  if (doc.buffers.length !== 1 || doc.buffers.some(b => b.uri !== undefined || b.byteLength > binarySize) ||
    doc.images?.some(i => i.uri !== undefined || i.bufferView === undefined || !doc.bufferViews?.[i.bufferView])) throw new Error("All GLB resources must be embedded.");
  if (doc.extensionsUsed?.some(e => !["KHR_materials_unlit", "KHR_texture_transform", "KHR_mesh_quantization"].includes(e))) throw new Error("Unsupported GLB extension. Export standard self-contained glTF 2.0.");
  for (const buffer of doc.bufferViews ?? []) if (buffer.buffer !== 0 || (buffer.byteOffset ?? 0) + buffer.byteLength > doc.buffers[0].byteLength) throw new Error("Invalid buffer range.");
  for (const accessor of doc.accessors) {
    const buffer = doc.bufferViews?.[accessor.bufferView];
    if (!buffer) throw new Error("Export dense accessors with valid buffer views.");
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[accessor.type];
    const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
    const elementBytes = components * componentBytes;
    const stride = buffer.byteStride ?? elementBytes;
    if (stride < elementBytes || stride > 252 || (accessor.byteOffset ?? 0) + stride * (accessor.count - 1) + elementBytes > buffer.byteLength) throw new Error("Accessor exceeds its buffer.");
  }
  const triangleCounts = doc.meshes.map(mesh => mesh.primitives.reduce((total, primitive) => {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error("Export triangulated meshes.");
    const index = primitive.indices ?? primitive.attributes.POSITION;
    const accessor = doc.accessors[index];
    const positions = doc.accessors[primitive.attributes.POSITION];
    if (!positions || positions.type !== "VEC3" || Object.values(primitive.attributes).some(i => !doc.accessors[i])) throw new Error("Invalid mesh attributes.");
    if (primitive.indices !== undefined && (accessor?.type !== "SCALAR" || ![5121, 5123, 5125].includes(accessor.componentType))) throw new Error("Invalid triangle indices.");
    if (!accessor || accessor.count % 3) throw new Error("Invalid triangle accessor.");
    return total + accessor.count / 3;
  }, 0));
  const nodeNames: string[] = [];
  let triangleCount = 0;
  let mappingReady = true;
  for (const node of doc.nodes) {
    if (node.children?.some(n => n >= doc.nodes.length)) throw new Error("Invalid node hierarchy.");
    if (node.mesh === undefined) continue;
    const triangles = triangleCounts[node.mesh];
    if (triangles === undefined) throw new Error("Invalid mesh reference.");
    triangleCount += triangles;
    if (!node.name || nodeNames.includes(node.name) || !/^[A-Za-z0-9_-]{1,100}$/.test(node.name)) mappingReady = false;
    else nodeNames.push(node.name);
  }
  const visited = new Set<number>();
  const active = new Set<number>();
  function visit(index: number) {
    if (active.has(index)) throw new Error("GLB node hierarchy contains a cycle.");
    if (visited.has(index)) return;
    active.add(index);
    for (const child of doc.nodes[index].children ?? []) visit(child);
    active.delete(index); visited.add(index);
  }
  for (let i = 0; i < doc.nodes.length; i++) visit(i);
  const scene = doc.scenes[doc.scene ?? 0];
  if (!scene || scene.nodes.some(index => !doc.nodes[index])) throw new Error("GLB requires a valid default scene.");
  visited.clear();
  for (const root of scene.nodes) visit(root);
  if (doc.nodes.some((node, index) => node.mesh !== undefined && !visited.has(index))) mappingReady = false;
  if (triangleCount < 1 || triangleCount > 150_000) throw new Error("GLB must contain 1–150,000 triangles.");
  return { nodeNames, triangleCount, mappingReady };
}
export async function boundedDownload(response: Response, maxBytes: number) {
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > maxBytes || !response.body) throw new Error("Asset download failed or exceeds the size limit.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maxBytes) throw new Error("Asset exceeds the size limit.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
