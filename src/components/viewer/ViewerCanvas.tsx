"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bounds, ContactShadows, Html, OrbitControls, useBounds } from "@react-three/drei";
import { Box3, Color, Group, LoadingManager, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Texture, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssemblyKind, AssemblyPart, ReviewedAssembly } from "@/lib/domain";
import type { PrivateMappedScene } from "@/lib/visual-repair";
import { applyExplode, capturePositions, combinedPartBounds, explodedPosition, MAX_GLB_BYTES, resolvePartNodes, restoreSourceNodeNames, validateSelfContainedGlb } from "./model-utils";

export interface ViewerCanvasProps {
  kind: AssemblyKind;
  assembly?: ReviewedAssembly;
  privateScene?: PrivateMappedScene;
  parts: AssemblyPart[];
  selectedId: string | null;
  hiddenIds: string[];
  isolateId: string | null;
  exploded: boolean;
  activePartIds: string[];
  resetKey: number;
  focusId: string | null;
  focusIds?: string[];
  focusKey: number;
  onPartSelect: (id: string) => void;
  onError: (message: string) => void;
  onReady: () => void;
}

export function finishModel(root: Object3D) {
  root.traverse((node) => {
    if (node instanceof Mesh) {
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) {
          if (value instanceof Texture) value.dispose();
        }
        material.dispose();
      }
    }
  });
}

export async function loadModel(url: string, signal: AbortSignal, localPreview = false): Promise<Group> {
  const parsedUrl = new URL(url, window.location.origin);
  if (!(["http:", "https:"].includes(parsedUrl.protocol) || (localPreview && parsedUrl.protocol === "blob:")) || parsedUrl.username || parsedUrl.password) {
    throw new Error("The model URL is not supported.");
  }
  const response = await fetch(parsedUrl, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`The model could not be downloaded (${response.status}).`);
  if (Number(response.headers.get("content-length")) > MAX_GLB_BYTES) throw new Error("The model exceeds the 10 MB viewer limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The model response could not be read.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_GLB_BYTES) throw new Error("The model exceeds the 10 MB viewer limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  validateSelfContainedGlb(bytes.buffer);
  const manager = new LoadingManager();
  manager.setURLModifier((resourceUrl) => {
    if (!resourceUrl.startsWith("blob:")) throw new Error("External model resources are blocked. Use embedded GLB textures.");
    return resourceUrl;
  });
  const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, "");
  restoreSourceNodeNames(gltf.scene, (node) => gltf.parser.associations.get(node)?.nodes, gltf.parser.json.nodes ?? []);
  return gltf.scene;
}

function ReviewedModel(props: ViewerCanvasProps) {
  const { assembly, privateScene, parts, onError } = props;
  const url = privateScene?.url ?? assembly?.url;
  const [model, setModel] = useState<Group | null>(null);
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 30_000);
    let loaded: Group | undefined;
    let cancelled = false;
    loadModel(url, abort.signal, !!privateScene).then((scene) => {
      if (cancelled) {
        finishModel(scene);
        return;
      }
      loaded = scene;
      resolvePartNodes(scene, parts);
      const sourceMaterials = new Set<Material>();
      scene.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) sourceMaterials.add(material);
        node.material = Array.isArray(node.material) ? node.material.map((material) => material.clone()) : node.material.clone();
        node.castShadow = true;
        node.receiveShadow = true;
      });
      for (const material of sourceMaterials) material.dispose();
      setModel(scene);
    }).catch((error: unknown) => {
      if (!cancelled) onError(abort.signal.aborted ? "The model download timed out. Check your connection and retry." : error instanceof Error ? error.message : "The model could not be loaded.");
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      abort.abort();
      if (loaded) finishModel(loaded);
    };
  }, [url, privateScene, parts, onError]);
  return model ? <MappedModel {...props} model={model} /> : null;
}

function MappedModel({ model, ...props }: ViewerCanvasProps & { model: Group }) {
  const bounds = useBounds();
  const { parts, exploded, hiddenIds, isolateId, selectedId, activePartIds, privateScene, onReady, onError } = props;
  const mapping = useMemo(() => resolvePartNodes(model, parts), [model, parts]);
  const originals = useMemo(() => capturePositions(mapping), [mapping]);
  const dimensions = useMemo(() => {
    const box = new Box3().setFromObject(model);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    return { center, scale: 3 / Math.max(size.x, size.y, size.z, 0.01) };
  }, [model]);
  const materials = useMemo(() => {
    const map = new Map<MeshStandardMaterial, { emissive: Color; intensity: number }>();
    for (const [id, nodes] of mapping) for (const root of nodes) {
      root.traverse((node) => {
        node.userData.viewerPartId = id;
        if (!(node instanceof Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof MeshStandardMaterial) map.set(material, { emissive: material.emissive.clone(), intensity: material.emissiveIntensity });
        }
      });
    }
    return map;
  }, [mapping]);
  const unlitColors = useMemo(() => {
    const colors = new Map<MeshBasicMaterial, Color>();
    model.traverse(node => {
      if (!(node instanceof Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof MeshBasicMaterial) colors.set(material, material.color.clone());
      }
    });
    return colors;
  }, [model]);
  useEffect(() => {
    try {
      if (privateScene) for (const part of parts) combinedPartBounds(model, [part.id]);
      onReady();
    } catch (error) { onError(error instanceof Error ? error.message : "Invalid model targets."); }
  }, [model, parts, materials, privateScene, onReady, onError]);
  useEffect(() => {
    applyExplode(mapping, originals, parts, exploded ? 1 : 0);
    model.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const id = node.userData.viewerPartId as string | undefined;
      node.visible = id ? !hiddenIds.includes(id) && (!isolateId || isolateId === id) : !isolateId;
      const highlighted = id && (id === selectedId || activePartIds.includes(id));
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof MeshBasicMaterial) {
          const original = unlitColors.get(material);
          if (original) material.color.copy(highlighted ? new Color("#91ad91") : original);
        }
        if (!(material instanceof MeshStandardMaterial)) continue;
        const original = materials.get(material);
        if (!original) continue;
        material.emissive.copy(highlighted ? new Color("#668670") : original.emissive);
        material.emissiveIntensity = highlighted ? 0.5 : original.intensity;
      }
    });
  }, [mapping, originals, model, parts, exploded, hiddenIds, isolateId, selectedId, activePartIds, materials, unlitColors]);
  useEffect(() => { bounds.refresh().clip().fit(); }, [bounds, model, exploded]);
  function select(event: ThreeEvent<MouseEvent>) {
    const id = event.object.userData.viewerPartId as string | undefined;
    if (id) {
      event.stopPropagation();
      props.onPartSelect(id);
    }
  }
  return (
    <group scale={dimensions.scale}>
      <group position={dimensions.center.clone().negate()}>
        <primitive object={model} onClick={select} />
      </group>
    </group>
  );
}

const brass = "#b79960";
const steel = "#adb7b5";
const dark = "#56665c";

function PreviewPart({ id, base = [0, 0, 0], color = brass, children, ...props }: ViewerCanvasProps & {
  id: string;
  base?: [number, number, number];
  color?: string;
  children: React.ReactNode;
}) {
  const part = props.parts.find((candidate) => candidate.id === id)!;
  const highlighted = props.selectedId === id || props.activePartIds.includes(id);
  const group = useRef<Group>(null);
  useEffect(() => {
    group.current?.traverse((node) => {
      if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) {
        node.material.color.set(highlighted ? "#91ad91" : color);
        node.material.emissive.set(highlighted ? "#42644a" : "#000000");
        node.material.emissiveIntensity = highlighted ? 0.22 : 0;
      }
    });
  }, [highlighted, color]);
  return (
    <group
      ref={group}
      userData={{ viewerPartId: id }}
      position={explodedPosition(base, part.explodeOffset, props.exploded ? 1 : 0)}
      visible={!props.hiddenIds.includes(id) && (!props.isolateId || props.isolateId === id)}
      onClick={(event) => { event.stopPropagation(); props.onPartSelect(id); }}
    >
      {children}
      {props.selectedId === id && <Html position={[0, 0.45, 0.3]} center style={{ pointerEvents: "none" }}>
        <span style={{ display: "block", whiteSpace: "nowrap", borderRadius: 8, padding: "6px 10px", background: "#294b38", color: "white", font: "500 12px system-ui", boxShadow: "0 4px 16px #23352622" }}>{part.label}</span>
      </Html>}
    </group>
  );
}

function Metal({ color = brass }: { color?: string }) {
  return <meshStandardMaterial color={color} metalness={0.58} roughness={0.29} />;
}

function Screw({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow><cylinderGeometry args={[0.065, 0.055, 0.28, 16]} /><Metal /></mesh>
      <mesh castShadow position={[0, 0.18, 0]}><cylinderGeometry args={[0.13, 0.095, 0.07, 24]} /><Metal /></mesh>
      <mesh position={[0, 0.219, 0]}><boxGeometry args={[0.145, 0.008, 0.026]} /><meshStandardMaterial color="#675431" /></mesh>
      <mesh position={[0, 0.219, 0]}><boxGeometry args={[0.026, 0.008, 0.145]} /><meshStandardMaterial color="#675431" /></mesh>
    </group>
  );
}

function Door(props: ViewerCanvasProps) {
  return <group>
    <PreviewPart {...props} id="door-frame" color="#d6c5a5">
      {[-0.89, 0.89].map(x => <mesh key={x} position={[x, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.15, 3.25, 0.3]}/><meshStandardMaterial color="#d6c5a5" roughness={0.8}/>
      </mesh>)}
      <mesh position={[0, 1.55, 0]} castShadow><boxGeometry args={[1.93, 0.15, 0.3]}/><meshStandardMaterial color="#d6c5a5" roughness={0.8}/></mesh>
    </PreviewPart>
    <PreviewPart {...props} id="door-panel" color="#b99159">
      <mesh castShadow receiveShadow><boxGeometry args={[1.6, 3, 0.13]}/><meshStandardMaterial color="#b99159" roughness={0.7}/></mesh>
      {[-1, 1].flatMap(side => [-0.38, 0.38].flatMap(x => [-0.72, 0.72].map(y => <mesh key={`${side}-${x}-${y}`} position={[x, y, side * 0.072]} castShadow>
        <boxGeometry args={[0.57, 1.12, 0.025]}/><meshStandardMaterial color="#b99159" roughness={0.85}/>
      </mesh>)))}
    </PreviewPart>
    <PreviewPart {...props} id="door-hinges">
      {[-1.1, 0, 1.1].map(y => <group key={y} position={[-0.81, y, 0.13]}>
        <mesh castShadow><cylinderGeometry args={[0.04, 0.04, 0.22, 16]}/><Metal/></mesh>
        <mesh castShadow position={[0.045, 0, -0.025]}><boxGeometry args={[0.18, 0.2, 0.03]}/><Metal/></mesh>
      </group>)}
    </PreviewPart>
    <PreviewPart {...props} id="door-handle" base={[0.64, -0.06, 0]}>
      {[-1, 1].map(side => <group key={side} position={[0, 0, side * 0.1]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.095, 0.095, 0.04, 24]}/><Metal/></mesh>
        <mesh position={[0, 0, side * 0.07]} castShadow><boxGeometry args={[0.05, 0.05, 0.14]}/><Metal/></mesh>
        <mesh position={[-0.12, 0, side * 0.13]} castShadow><boxGeometry args={[0.28, 0.055, 0.06]}/><Metal/></mesh>
      </group>)}
    </PreviewPart>
  </group>;
}

function Hinge(props: ViewerCanvasProps) {
  return <group rotation={[0, -0.22, 0]}>
    <PreviewPart {...props} id="hinge-frame" base={[-0.53, 0, 0]}>
      <mesh castShadow receiveShadow><boxGeometry args={[0.94, 2.05, 0.12]} /><Metal /></mesh>
      {[-0.78, 0, 0.78].map((y) => <mesh key={y} position={[0.48, y, 0.045]} castShadow><cylinderGeometry args={[0.16, 0.16, 0.38, 32]} /><Metal /></mesh>)}
    </PreviewPart>
    <PreviewPart {...props} id="hinge-door" base={[0.53, 0, 0]}>
      <mesh castShadow receiveShadow><boxGeometry args={[0.94, 2.05, 0.12]} /><Metal /></mesh>
      {[-0.39, 0.39].map((y) => <mesh key={y} position={[-0.48, y, 0.045]} castShadow><cylinderGeometry args={[0.16, 0.16, 0.38, 32]} /><Metal /></mesh>)}
    </PreviewPart>
    <PreviewPart {...props} id="hinge-pin" base={[0, 0, 0.045]} color={steel}>
      <mesh castShadow><cylinderGeometry args={[0.085, 0.085, 2.24, 24]} /><Metal color={steel} /></mesh>
      <mesh position={[0, 1.13, 0]} castShadow><sphereGeometry args={[0.135, 24, 16]} /><Metal color={steel} /></mesh>
      <mesh position={[0, -1.12, 0]} castShadow><sphereGeometry args={[0.11, 24, 16]} /><Metal color={steel} /></mesh>
    </PreviewPart>
    <PreviewPart {...props} id="hinge-screws">
      {[-0.58, 0.58].flatMap((x) => [-0.7, 0, 0.7].map((y) => <Screw key={`${x}-${y}`} position={[x, y, 0.09]} />))}
    </PreviewPart>
  </group>;
}

function Knob(props: ViewerCanvasProps) {
  return <group rotation={[0, -0.55, 0]}>
    <PreviewPart {...props} id="knob-body" base={[0, 0, 0.6]}>
      <mesh castShadow scale={[1, 1, 0.62]}><sphereGeometry args={[0.68, 48, 32]} /><Metal /></mesh>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.44]}><cylinderGeometry args={[0.2, 0.3, 0.42, 32]} /><Metal /></mesh>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.69]}><cylinderGeometry args={[0.38, 0.38, 0.1, 40]} /><Metal /></mesh>
    </PreviewPart>
    <PreviewPart {...props} id="knob-washer" base={[0, 0, -0.38]} color={steel}>
      <mesh castShadow><torusGeometry args={[0.26, 0.072, 12, 40]} /><Metal color={steel} /></mesh>
    </PreviewPart>
    <PreviewPart {...props} id="knob-screw" base={[0, 0, -0.8]} color={steel}>
      <group rotation={[Math.PI / 2, 0, 0]}>
        <mesh castShadow><cylinderGeometry args={[0.09, 0.09, 0.68, 24]} /><Metal color={steel} /></mesh>
        <mesh castShadow position={[0, 0.38, 0]}><cylinderGeometry args={[0.2, 0.2, 0.1, 32]} /><Metal color={steel} /></mesh>
        {[-0.24, -0.12, 0, 0.12, 0.24].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.092, 0.019, 8, 24]} /><Metal color={steel} /></mesh>)}
      </group>
    </PreviewPart>
  </group>;
}

function Aerator(props: ViewerCanvasProps) {
  return <group rotation={[0.2, 0, 0.12]}>
    <PreviewPart {...props} id="aerator-housing" base={[0, -0.38, 0]} color={steel}>
      <mesh castShadow><cylinderGeometry args={[0.72, 0.66, 0.72, 48, 1, true]} /><meshStandardMaterial color={steel} metalness={0.75} roughness={0.25} side={2} /></mesh>
      {[-0.35, 0.35].map((y) => <mesh castShadow key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[y > 0 ? 0.72 : 0.66, 0.055, 12, 48]} /><Metal color={steel} /></mesh>)}
      {[-0.2, -0.05, 0.1, 0.25].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.7, 0.014, 8, 48]} /><Metal color={steel} /></mesh>)}
    </PreviewPart>
    <PreviewPart {...props} id="aerator-screen" base={[0, 0.12, 0]} color={brass}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.54, 0.07, 12, 48]} /><Metal /></mesh>
      {[-0.36, -0.18, 0, 0.18, 0.36].flatMap((offset) => {
        const length = 2 * Math.sqrt(0.5 ** 2 - offset ** 2);
        return [
          <mesh key={`x${offset}`} position={[0, 0, offset]}><boxGeometry args={[length, 0.035, 0.025]} /><Metal /></mesh>,
          <mesh key={`z${offset}`} position={[offset, 0.015, 0]}><boxGeometry args={[0.025, 0.035, length]} /><Metal /></mesh>,
        ];
      })}
    </PreviewPart>
    <PreviewPart {...props} id="aerator-gasket" base={[0, 0.35, 0]} color={dark}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.52, 0.095, 12, 48]} /><meshStandardMaterial color={dark} roughness={0.92} /></mesh>
    </PreviewPart>
  </group>;
}

function Preview(props: ViewerCanvasProps) {
  const bounds = useBounds();
  const { onReady, exploded } = props;
  useEffect(() => { onReady(); }, [onReady]);
  useEffect(() => { bounds.refresh().clip().fit(); }, [bounds, exploded]);
  return props.kind === "door" ? <Door {...props} /> : props.kind === "knob" ? <Knob {...props} /> : props.kind === "aerator" ? <Aerator {...props} /> : <Hinge {...props} />;
}

function FocusableAssembly(props: ViewerCanvasProps) {
  const root = useRef<Group>(null);
  const bounds = useBounds();
  const { focusId, focusIds, focusKey, onError } = props;
  useEffect(() => {
    const ids = focusIds?.length ? focusIds : focusId ? [focusId] : [];
    if (!root.current || !ids.length) return;
    try { bounds.refresh(combinedPartBounds(root.current, ids)).clip().fit(); }
    catch (error) { onError(error instanceof Error ? error.message : "The model target could not be located."); }
  }, [bounds, focusId, focusIds, focusKey, onError]);
  return <group ref={root}>{props.assembly || props.privateScene ? <ReviewedModel {...props}/> : <Preview {...props}/>}</group>;
}

function ContextLossHandler({ onError }: Pick<ViewerCanvasProps, "onError">) {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onError("The 3D graphics context was lost. Stop working on the repair and retry the viewer.");
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onError]);
  return null;
}

function Unavailable({ onError }: Pick<ViewerCanvasProps, "onError">) {
  useEffect(() => { onError("WebGL is unavailable in this browser. Instructions remain locked. Enable 3D graphics or try another browser."); }, [onError]);
  return null;
}

export function PrivateMappedCanvas({ scene, activePartIds, focusIds, focusKey, onError, onReady }: {
  scene: PrivateMappedScene; activePartIds: string[]; focusIds: string[]; focusKey: number;
  onError: (message: string) => void; onReady: () => void;
}) {
  return <ViewerCanvas kind="hinge" privateScene={scene} parts={scene.parts} activePartIds={activePartIds} focusIds={focusIds} focusKey={focusKey} focusId={null} resetKey={0} selectedId={null} hiddenIds={[]} isolateId={null} exploded={false} onPartSelect={() => {}} onError={onError} onReady={onReady}/>;
}

export default function ViewerCanvas(props: ViewerCanvasProps) {
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <Canvas
      shadows
      dpr={[1, 1.7]}
      camera={{ position: [4.6, 3.3, 6.8], fov: 38 }}
      gl={{ antialias: true, alpha: true }}
      fallback={props.privateScene ? <Unavailable onError={props.onError}/> : <span>3D is not supported. Use the labeled parts list.</span>}
      aria-label="Interactive assembly. Use the labeled parts and view controls below for keyboard access."
    >
      <ContextLossHandler onError={props.onError}/>
      <ambientLight intensity={1.1} />
      <hemisphereLight args={["#fff6df", "#b7c0ad", 1.5]} />
      <directionalLight castShadow position={[3, 6, 4]} intensity={3.2} shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 2, -3]} intensity={2} color="#eef5ed" />
      <Bounds fit clip observe margin={1.45} maxDuration={reducedMotion ? 0 : 0.3}>
        <FocusableAssembly key={props.resetKey} {...props}/>
      </Bounds>
      <ContactShadows position={[0, -2.2, 0]} opacity={0.25} scale={12} blur={2.8} far={5} resolution={256} />
      <OrbitControls key={`orbit-${props.resetKey}`} makeDefault minDistance={0.25} maxDistance={15} enablePan={false} enableDamping={!reducedMotion} maxPolarAngle={Math.PI * 0.85} />
    </Canvas>
  );
}
