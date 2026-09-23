"use client";

import { useCallback, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, OrbitControls } from "@react-three/drei";
import { Box3, type Group } from "three";
import { ContextLossHandler, finishModel, loadModel, useWebGLAvailable } from "./viewer/ViewerCanvas";

function Mascot({ model, rotation, onReady }: { model: Group; rotation: number; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return <group rotation={[0, rotation - Math.PI / 2, 0]}><Center><primitive object={model}/></Center></group>;
}

export default function HomeMascotCanvas({ rotation, onReady, onError }: {
  rotation: number; onReady: () => void; onError: (message: string) => void;
}) {
  const [model, setModel] = useState<Group | null>(null);
  const onGraphicsError = useCallback(() => onError("3D graphics are unavailable in this browser."), [onError]);
  const available = useWebGLAvailable(onGraphicsError);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let disposed = false;
    let loaded: Group | undefined;
    loadModel("/handy-manny-3d.glb", controller.signal).then(scene => {
      if (disposed) { finishModel(scene); return; }
      loaded = scene;
      const bounds = new Box3().setFromObject(scene);
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) || bounds.min.distanceTo(bounds.max) <= 0) {
        throw new Error("The mascot has no usable 3D geometry.");
      }
      setModel(scene);
    }).catch((error: unknown) => {
      if (!disposed) onError(controller.signal.aborted ? "The 3D mascot download timed out." : error instanceof Error ? error.message : "The 3D mascot could not load.");
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
      if (loaded) finishModel(loaded);
    };
  }, [onError]);

  return model && available && <Canvas
    dpr={[1, 1.5]}
    frameloop="demand"
    camera={{ position: [0, 0.4, 5], fov: 36 }}
    gl={{ alpha: true, antialias: true }}
    fallback={<span>3D graphics are unavailable in this browser.</span>}
    aria-label="Interactive muscular Handy Manny model. Drag to rotate or use the turn buttons."
  >
    <ContextLossHandler onError={onGraphicsError}/>
    <ambientLight intensity={1.4}/>
    <hemisphereLight args={["#fff7e6", "#a4b798", 1.4]}/>
    <directionalLight position={[3, 5, 5]} intensity={2.5}/>
    <directionalLight position={[-4, 2, -3]} intensity={1.2}/>
    <Bounds fit clip observe margin={1.15}>
      <Mascot model={model} rotation={rotation} onReady={onReady}/>
    </Bounds>
    <OrbitControls makeDefault enableZoom={false} enablePan={false} enableDamping={false} minPolarAngle={Math.PI * 0.2} maxPolarAngle={Math.PI * 0.8}/>
  </Canvas>;
}
