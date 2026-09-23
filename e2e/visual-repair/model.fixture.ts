import { BoxGeometry } from "three";

export function fixtureGlb() {
  const geometry = new BoxGeometry(1, 1, 1).toNonIndexed();
  const positions = new Float32Array(geometry.getAttribute("position").array);
  geometry.dispose();
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.6, 0.5, 0.35, 1], metallicFactor: 0, roughnessFactor: 0.7 } }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
    ],
    nodes: [
      { name: "handle", mesh: 0, translation: [0, 0, 1], scale: [0.8, 0.2, 0.2] },
      { name: "panel", mesh: 1, translation: [0, 0, 0], scale: [2, 3, 0.2] },
    ],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonSize = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonSize + positions.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonSize, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonSize);
  bytes.set(json, 20);
  view.setUint32(20 + jsonSize, positions.byteLength, true);
  view.setUint32(24 + jsonSize, 0x004e4942, true);
  bytes.set(new Uint8Array(positions.buffer), 28 + jsonSize);
  return bytes;
}
