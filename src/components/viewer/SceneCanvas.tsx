"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import { finishModel, loadModel } from "./ViewerCanvas";

export default function SceneCanvas({ url, onError }: { url: string; onError: (message: string) => void }) {
  const [model, setModel] = useState<Group | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let disposed = false;
    let loaded: Group | undefined;
    loadModel(url, controller.signal, true).then(scene => {
      if (disposed) { finishModel(scene); return; }
      loaded = scene;
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
  return <div style={{ height: 360 }} aria-label="Unreviewed Tripo spatial context">
    {!model && <p role="status">Loading generated geometry...</p>}
    {model && <Canvas camera={{ position: [3, 2, 4], fov: 45 }}>
      <ambientLight intensity={1.5}/>
      <directionalLight position={[4, 6, 5]} intensity={2}/>
      <Bounds fit clip observe margin={1.3}><Center><primitive object={model}/></Center></Bounds>
      <OrbitControls makeDefault/>
    </Canvas>}
  </div>;
}
