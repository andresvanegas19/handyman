"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { Component, useCallback, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import styles from "./home-illustration.module.css";

const MascotCanvas = dynamic(() => import("./home-mascot-canvas"), { ssr: false });

class MascotBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    this.props.onError(`The 3D mascot could not start. ${error.message}`);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function HomeMascot() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback((message: string) => {
    setError(message);
    setReady(false);
  }, []);
  function reset() {
    setRotation(0);
    setReady(false);
    setError(null);
    setResetKey(value => value + 1);
  }

  return <div className={styles.portrait} role="region" aria-label="Muscular Handy Manny in 3D">
    <div className={styles.stage}>
      {!error && <div className={styles.canvas}><MascotBoundary key={resetKey} onError={onError}>
        <MascotCanvas rotation={rotation} onReady={onReady} onError={onError}/>
      </MascotBoundary></div>}
      {!ready && <Image
        src="/handy-manny-3d.png"
        alt="Muscular 3D Handy Manny flexing and holding a red toolbox"
        fill
        sizes="(max-width: 600px) 390px, (max-width: 1050px) 50vw, 620px"
        priority
        className={styles.image}
      />}
    </div>
    {error ? <div className={styles.error} role="status">
      <span>{error} Showing the still image.</span>
      <button type="button" onClick={reset}>Retry 3D</button>
    </div> : <div className={styles.controls}>
      <button type="button" aria-label="Turn Handy Manny left" disabled={!ready} onClick={() => setRotation(value => value - Math.PI / 6)}><ChevronLeft size={16}/></button>
      <span role="status">{ready ? "Drag to rotate · Tripo 3D" : "Loading Tripo 3D..."}</span>
      <button type="button" aria-label="Turn Handy Manny right" disabled={!ready} onClick={() => setRotation(value => value + Math.PI / 6)}><ChevronRight size={16}/></button>
      <button type="button" aria-label="Reset Handy Manny view" disabled={!ready} onClick={reset}><RotateCcw size={14}/></button>
    </div>}
  </div>;
}
