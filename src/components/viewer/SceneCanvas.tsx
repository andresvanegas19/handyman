"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, OrbitControls } from "@react-three/drei";
import { Box3, type Group } from "three";
import { ContextLossHandler, finishModel, loadModel, useWebGLAvailable } from "./ViewerCanvas";

function VisibleModel({ model, onReady }: { model: Group; onReady?: () => void }) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return <primitive object={model}/>;
}

export default function SceneCanvas({ url, onError, onReady, fill = false, resetKey = 0 }: {
  url: string; onError: (message: string) => void; onReady?: () => void; fill?: boolean; resetKey?: number;
}) {
  const [model, setModel] = useState<Group | null>(null);
  const available = useWebGLAvailable(onError);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let disposed = false;
    let loaded: Group | undefined;
    loadModel(url, controller.signal, true).then(scene => {
      if (disposed) { finishModel(scene); return; }
      loaded = scene;
      const bounds = new Box3().setFromObject(scene);
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) || bounds.min.distanceTo(bounds.max) <= 0) {
        throw new Error("The generated model has no usable visible geometry.");
      }
      setModel(scene);
    }).catch((error: unknown) => {
      if (!disposed) onError(error instanceof Error ? error.message : "The scene could not be loaded.");
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
      if (loaded) finishModel(loaded);
    };
  }, [url, onError]);
  return <div style={{ height: fill ? "100%" : 360 }} aria-label="Unreviewed Tripo spatial context">
    {!model && <p role="status">Loading generated geometry...</p>}
    {model && available && <Canvas key={resetKey} camera={{ position: [3, 2, 4], fov: 45 }}>
      <ContextLossHandler onError={onError}/>
      <ambientLight intensity={1.5}/>
      <directionalLight position={[4, 6, 5]} intensity={2}/>
      <Bounds fit clip observe margin={1.3}><Center><VisibleModel model={model} onReady={onReady}/></Center></Bounds>
      <OrbitControls makeDefault/>
    </Canvas>}
  </div>;
}
