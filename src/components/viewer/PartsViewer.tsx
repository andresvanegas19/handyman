"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Box, Check, ChevronRight, Eye, EyeOff, Layers3, Maximize2, RotateCcw } from "lucide-react";
import type { AssemblyKind, ReviewedAssembly } from "@/lib/domain";
import { PREVIEW_PARTS } from "./parts";
import styles from "./PartsViewer.module.css";

const ViewerCanvas = dynamic(() => import("./ViewerCanvas"), {
  ssr: false,
  loading: () => <div className={styles.loading}>Preparing your 3D view…</div>,
});
const EMPTY_PART_IDS: string[] = [];

export interface PartsViewerProps {
  kind?: AssemblyKind;
  assembly?: ReviewedAssembly;
  activePartIds?: string[];
  onPartSelect?: (id: string) => void;
}

class CanvasBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    this.props.onError(`The 3D view could not start. ${error.message}`);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function Diagram({ kind, exploded, selected, hidden }: { kind: AssemblyKind; exploded: boolean; selected: string | null; hidden: string[] }) {
  const fill = (id: string, base = "#b79c6c") => selected === id ? "#789b80" : base;
  const opacity = (id: string) => hidden.includes(id) ? 0.12 : 1;
  return <svg viewBox="0 0 460 300" className={styles.diagram} role="img" aria-label={`Illustrative ${kind} diagram, not a reviewed model. Labeled part descriptions follow.`}>
    <ellipse cx="230" cy="252" rx="110" ry="15" fill="#233526" opacity=".07" />
    {kind === "hinge" ? <g transform="translate(230 140) rotate(-12)">
      <g transform={`translate(${exploded ? -38 : 0} 0)`} opacity={opacity("hinge-frame")}>
        <rect x="-85" y="-77" width="78" height="154" rx="5" fill={fill("hinge-frame")} stroke="#8a754e" />
        <path d="M-13 -76v152" stroke="#dac69d" strokeWidth="8" />
      </g>
      <g transform={`translate(${exploded ? 38 : 0} 0)`} opacity={opacity("hinge-door")}>
        <rect x="7" y="-77" width="78" height="154" rx="5" fill={fill("hinge-door", "#c6ac7d")} stroke="#8a754e" />
        <path d="M13 -76v152" stroke="#e1cfaa" strokeWidth="8" />
      </g>
      <g transform={`translate(0 ${exploded ? -38 : 0})`} opacity={opacity("hinge-pin")}>
        <rect x="-7" y="-84" width="14" height="171" rx="5" fill={fill("hinge-pin", "#9ba9a4")} />
        <ellipse cx="0" cy="-84" rx="10" ry="6" fill="#bcc8c2" />
      </g>
      <g transform={`translate(0 ${exploded ? 28 : 0})`} opacity={opacity("hinge-screws")}>
        {[-48, 48].flatMap((x) => [-49, 0, 49].map((y) => <g key={`${x}-${y}`}><circle cx={x} cy={y} r="8" fill={fill("hinge-screws", "#e8d6ad")} stroke="#8a754e" /><path d={`M${x - 4} ${y}h8m-4 -4v8`} stroke="#8a754e" /></g>))}
      </g>
    </g> : kind === "knob" ? <g transform="translate(230 140) rotate(-22)">
      <g transform={`translate(${exploded ? -58 : -28} 0)`} opacity={opacity("knob-screw")} fill={fill("knob-screw", "#9ba9a4")}>
        <rect x="-66" y="-9" width="75" height="18" rx="4" /><rect x="-71" y="-22" width="12" height="44" rx="5" />
        {[-51, -40, -29, -18].map((x) => <path key={x} d={`M${x} -9l5 18`} stroke="#697d71" />)}
      </g>
      <ellipse cx={exploded ? -12 : 0} cy="0" rx="12" ry="35" fill="none" stroke={fill("knob-washer", "#acb7af")} strokeWidth="8" opacity={opacity("knob-washer")} />
      <g transform={`translate(${exploded ? 55 : 15} 0)`} opacity={opacity("knob-body")} fill={fill("knob-body")}>
        <rect x="0" y="-24" width="46" height="48" rx="6" /><ellipse cx="62" cy="0" rx="43" ry="60" stroke="#a48c5f" /><ellipse cx="73" cy="-12" rx="17" ry="31" fill="#e6d4ab" opacity=".5" />
      </g>
    </g> : <g transform="translate(230 150)">
      <g transform={`translate(0 ${exploded ? 35 : 15})`} opacity={opacity("aerator-housing")}>
        <path d="M-62 -15v64c0 26 124 26 124 0v-64" fill={fill("aerator-housing", "#adbab2")} stroke="#83958a" />
        <ellipse cy="-15" rx="62" ry="23" fill="#dce2dc" stroke="#83958a" strokeWidth="5" /><ellipse cy="-15" rx="51" ry="16" fill="#697d70" />
        {[15, 26, 37].map((y) => <path key={y} d={`M-60 ${y}q60 29 120 0`} fill="none" stroke="#e0e6de" strokeWidth="2" />)}
      </g>
      <g transform={`translate(0 ${exploded ? -35 : -4})`} opacity={opacity("aerator-screen")}>
        <ellipse rx="52" ry="19" fill={fill("aerator-screen", "#dbc9a4")} stroke="#ab925f" strokeWidth="5" />
        {[-30, -15, 0, 15, 30].map((x) => <path key={x} d={`M${x} -13v26`} stroke="#a48b5d" strokeWidth="2" />)}
        <path d="M-42 -6h84m-90 9h96" stroke="#a48b5d" strokeWidth="2" />
      </g>
      <ellipse cy={exploded ? -92 : -37} rx="51" ry="18" fill="none" stroke={fill("aerator-gasket", "#536b5c")} strokeWidth="9" opacity={opacity("aerator-gasket")} />
    </g>}
  </svg>;
}

function PartsViewerInstance({ kind = "hinge", assembly, activePartIds = EMPTY_PART_IDS, onPartSelect }: PartsViewerProps) {
  const parts = assembly ? assembly.parts : PREVIEW_PARTS[kind];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [isolateId, setIsolateId] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(assembly && !assembly.reviewed ? "This assembly has not been reviewed. Its 3D model is unavailable until review is complete." : null);
  const [ready, setReady] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const labelId = useId();
  useEffect(() => { setAvailable(supportsWebGL()); }, []);
  const reportError = useCallback((message: string) => { setError(message); setReady(false); }, []);
  const markReady = useCallback(() => setReady(true), []);
  const selectPart = useCallback((id: string) => {
    setSelectedId(id);
    setHiddenIds((current) => current.filter((partId) => partId !== id));
    setIsolateId((current) => current ? id : null);
    onPartSelect?.(id);
  }, [onPartSelect]);
  function reset() {
    setSelectedId(null);
    setHiddenIds([]);
    setIsolateId(null);
    setExploded(false);
    setResetKey((key) => key + 1);
  }
  function retry() {
    if (assembly && !assembly.reviewed) return;
    setError(null);
    setAvailable(supportsWebGL());
    setReady(false);
    setResetKey((key) => key + 1);
  }
  const selected = parts.find((part) => part.id === selectedId);
  const unknownHighlights = activePartIds.filter((id) => !parts.some((part) => part.id === id));
  const fallback = available === false || !!error;
  const diagramHidden = isolateId ? parts.filter((part) => part.id !== isolateId).map((part) => part.id) : hiddenIds;
  return (
    <section className={styles.viewer} aria-labelledby={labelId}>
      <div className={styles.heading}>
        <div className={styles.headingIcon}><Box size={19} strokeWidth={1.5} /></div>
        <div><h3 id={labelId}>A closer look</h3><p>Understand the parts, without taking anything apart.</p></div>
        <span className={styles.interactive}>{fallback ? "PARTS VIEW" : "INTERACTIVE 3D"}</span>
      </div>
      <div className={styles.stage}>
        <div className={styles.modelBadge}><span />{assembly ? assembly.reviewed ? "Reviewed assembly" : "Unreviewed assembly · unavailable" : "Illustrative preview · not a Tripo model"}</div>
        {!assembly && (available !== true || fallback) && <Diagram kind={kind} exploded={exploded} selected={selectedId} hidden={diagramHidden} />}
        {assembly && (available !== true || fallback) && <div className={styles.textFallback}><Box size={40} strokeWidth={1} /><strong>{fallback ? "Explore the labeled parts below" : "Preparing the reviewed model"}</strong><span>No substitute model is shown.</span></div>}
        {available === true && !error && <CanvasBoundary key={resetKey} onError={reportError}>
          <ViewerCanvas kind={kind} assembly={assembly} parts={parts} selectedId={selectedId} hiddenIds={hiddenIds} isolateId={isolateId} exploded={exploded} activePartIds={activePartIds} resetKey={resetKey} onPartSelect={selectPart} onError={reportError} onReady={markReady} />
        </CanvasBoundary>}
        {available === true && !error && !ready && <div className={styles.loading} role="status">Loading {assembly ? "reviewed model" : "illustrative preview"}…</div>}
        <div className={styles.stageHint}>{fallback ? "Text alternative · every part is described below" : "Drag to rotate · scroll or pinch to zoom"}</div>
      </div>
      {fallback && <div className={styles.notice} role={error ? "alert" : "status"}>
        <span>{error || (assembly ? "3D is unavailable in this browser. The reviewed part descriptions remain available below." : "3D is unavailable in this browser. The illustrative diagram and labeled part descriptions remain available.")}</span>
        {(!assembly || assembly.reviewed) && <button type="button" onClick={retry}>Retry 3D</button>}
      </div>}
      {!!unknownHighlights.length && <p className={styles.notice} role="alert">This step references parts that are not mapped in this model. Check the written guide; do not infer a matching component.</p>}
      <div className={styles.toolbar} aria-label="Assembly view controls">
        <button type="button" onClick={() => setExploded((current) => !current)} aria-pressed={exploded} className={exploded ? styles.engaged : ""}><Layers3 size={16} />{exploded ? "Assemble view" : "Explode view"}</button>
        <button type="button" onClick={() => setIsolateId((current) => current ? null : selectedId)} disabled={!selectedId} aria-pressed={!!isolateId}><Maximize2 size={15} />{isolateId ? "Show all parts" : "Isolate part"}</button>
        <button type="button" className={styles.reset} onClick={reset} aria-label="Reset assembly view"><RotateCcw size={15} /><span>Reset</span></button>
      </div>
      <div className={styles.partsHeading}><span>MEET THE PARTS</span><span>{parts.length} labeled parts</span></div>
      <ul className={styles.partList} aria-label="Assembly parts">
        {parts.map((part, index) => {
          const active = selectedId === part.id;
          const stepActive = activePartIds.includes(part.id);
          const hidden = hiddenIds.includes(part.id);
          return <li key={part.id} className={`${styles.part} ${active ? styles.selected : ""} ${stepActive ? styles.stepActive : ""}`}>
            <button type="button" className={styles.partSelect} aria-pressed={active} onClick={() => selectPart(part.id)}>
              <span className={styles.partNumber} aria-hidden="true">{active ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</span>
              <span>{part.label}{stepActive && <small>In this step</small>}</span>
              <ChevronRight size={14} className={styles.chevron} />
            </button>
            <button type="button" className={styles.visibility} aria-label={`${hidden ? "Show" : "Hide"} ${part.label}`} aria-pressed={!hidden} onClick={() => setHiddenIds((current) => hidden ? current.filter((id) => id !== part.id) : [...current, part.id])}>
              {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            {(active || fallback) && <p className={styles.partDescription}>{part.description}</p>}
          </li>;
        })}
      </ul>
      {selected && <p className={styles.selectionStatus} role="status">{selected.label} selected{isolateId ? " · isolated" : ""}{hiddenIds.includes(selected.id) ? " · hidden" : ""}.</p>}
      <p className={styles.disclaimer}>{assembly ? "A reviewed reference, not a scan of your home." : "Generic shapes for exploration, not reviewed repair guidance."} Exploded views explain parts—not safe disassembly or actual dimensions.</p>
    </section>
  );
}

export default function PartsViewer(props: PartsViewerProps) {
  return <PartsViewerInstance key={`${props.kind ?? "hinge"}:${props.assembly?.url ?? "preview"}:${props.assembly?.reviewed ?? false}`} {...props} />;
}
