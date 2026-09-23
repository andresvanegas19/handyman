"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Box, Check, ChevronRight, Eye, EyeOff, Layers3, Maximize2, RotateCcw } from "lucide-react";
import type { AssemblyKind, ReviewedAssembly } from "@/lib/domain";
import { PREVIEW_PARTS } from "./parts";
import styles from "./PartsViewer.module.css";

const ViewerCanvas = dynamic(() => import("./ViewerCanvas"), {
  ssr: false,
  loading: () => null,
});
const EMPTY_PART_IDS: string[] = [];

export interface PartsViewerProps {
  kind?: AssemblyKind;
  assembly?: ReviewedAssembly;
  activePartIds?: string[];
  onPartSelect?: (id: string | null) => void;
  /** Administrative inspection only; never changes an assembly's review status. */
  reviewMode?: boolean;
  immersive?: boolean;
  overlay?: ReactNode;
  stageControls?: ReactNode;
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

function Diagram({ kind, exploded, selected, hidden, highlighted }: { kind: AssemblyKind; exploded: boolean; selected: string | null; hidden: string[]; highlighted: string[] }) {
  const fill = (id: string, base = "#b79c6c") => selected === id || highlighted.includes(id) ? "#789b80" : base;
  const opacity = (id: string) => hidden.includes(id) ? 0 : 1;
  return <svg viewBox="0 0 460 300" className={styles.diagram} role="img" aria-label={`Illustrative ${kind} diagram, not a reviewed model. Labeled part descriptions follow.`}>
    <ellipse cx="230" cy="252" rx="110" ry="15" fill="#233526" opacity=".07" />
    {kind === "door" ? <g transform="translate(230 145)">
      <g transform={`translate(${exploded ? -60 : 0} 0)`} opacity={opacity("door-frame")}>
        <path d="M-63 100V-110H63V100" fill="none" stroke={fill("door-frame", "#d6c5a5")} strokeWidth="13"/>
      </g>
      <g transform={`translate(${exploded ? 15 : 0} ${exploded ? 12 : 0})`} opacity={opacity("door-panel")}>
        <rect x="-53" y="-100" width="106" height="200" fill={fill("door-panel", "#b99159")}/>
        {[-43, 7].flatMap(x => [-88, 9].map(y => <rect key={`${x}-${y}`} x={x} y={y} width="36" height="79" rx="2" fill="none" stroke="#866c47" strokeWidth="2"/>))}
      </g>
      <g transform={`translate(${exploded ? -27 : 0} ${exploded ? -8 : 0})`} opacity={opacity("door-hinges")}>
        {[-75, 0, 75].map(y => <rect key={y} x="-61" y={y - 8} width="12" height="16" rx="2" fill={fill("door-hinges")} stroke="#8a754e"/>)}
      </g>
      <g transform={`translate(${exploded ? 76 : 0} 0)`} opacity={opacity("door-handle")}>
        <circle cx="40" cy="2" r="7" fill={fill("door-handle", "#dfc58b")} stroke="#8a754e"/>
        <rect x="22" y="-1" width="22" height="5" rx="2" fill={fill("door-handle", "#dfc58b")} stroke="#8a754e"/>
      </g>
    </g> : kind === "hinge" ? <g transform="translate(230 140) rotate(-12)">
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
    </g> : kind === "washer-control" ? <g transform="translate(230 145)">
      <g transform={`translate(${exploded ? -60 : 0} 0)`} opacity={opacity("washer-panel")}>
        <rect x="-140" y="-100" width="280" height="205" rx="8" fill={fill("washer-panel", "#343832")}/>
      </g>
      <g transform={`translate(${exploded ? -40 : 0} 0)`} opacity={opacity("washer-dial")}>
        <circle r="77" fill={fill("washer-dial", "#a8b1a4")} stroke="#d4d7c7" strokeWidth="3"/>
        {Array.from({ length: 12 }, (_, index) => <path key={index} d="M0 -62v-9" transform={`rotate(${index * 30})`} stroke="#404c40" strokeWidth="3"/>)}
        <circle r="17" fill="#343832"/>
      </g>
      <g transform={`translate(${exploded ? 25 : 0} 0)`} opacity={opacity("washer-shaft")}>
        <rect x="-9" y="-9" width="45" height="18" rx="3" fill={fill("washer-shaft", "#c5ccc5")} stroke="#6b7a6b"/>
      </g>
      <g transform={`translate(${exploded ? 103 : 0} ${exploded ? 25 : 0})`} opacity={opacity("washer-knob")}>
        <ellipse rx="49" ry="54" fill={fill("washer-knob", "#353c36")} stroke="#87917f" strokeWidth="3"/>
        <ellipse cx="7" cy="-4" rx="36" ry="43" fill="none" stroke="#87917f" strokeWidth="2"/>
      </g>
    </g> : kind === "thermostat" ? <g transform="translate(230 145)">
      <g transform={`translate(${exploded ? -70 : 0} 0)`} opacity={opacity("thermostat-trim")}>
        <rect x="-100" y="-112" width="200" height="224" rx="9" fill={fill("thermostat-trim", "#ded9ca")} stroke="#b3b5a9"/>
        <circle r="24" fill="#303830"/>
      </g>
      <g transform={`translate(${exploded ? -30 : 0} 0)`} opacity={opacity("thermostat-base")}>
        <circle r="63" fill="none" stroke={fill("thermostat-base", "#ebe8dc")} strokeWidth="42"/>
        <circle r="84" fill="none" stroke="#b3b5a9" strokeWidth="2"/>
      </g>
      <g transform={`translate(${exploded ? 77 : 0} 0)`} opacity={opacity("thermostat-terminals")}>
        {[-1, 1].flatMap(side => [-36, -12, 12, 36].map(y => <rect key={`${side}-${y}`} x={side * Math.sqrt(60 ** 2 - y ** 2) - 9} y={y - 9} width="18" height="18" rx="2" fill={fill("thermostat-terminals", "#505b58")}/>))}
      </g>
      <g transform={`translate(${exploded ? -100 : 0} ${exploded ? 25 : 0})`} opacity={opacity("thermostat-wires")} fill="none" stroke={fill("thermostat-wires", "#8b938d")} strokeWidth="4" strokeLinecap="round">
        {["M-8 4C-25-30-35-50-40-95", "M-4 4C-10-10-40-30-70-40", "M0 4C20 20 55 15 80 32", "M4 4C-20 40-35 30-45 70", "M8 4C20 35 45 50 60 90"].map(d => <path key={d} d={d}/>)}
      </g>
      <g transform={`translate(0 ${exploded ? -32 : 0})`} opacity={opacity("thermostat-screws")}>
        {[-68, 68].map(y => <g key={y}><circle cy={y} r="8" fill={fill("thermostat-screws", "#adb7b5")} stroke="#6f7d75"/><path d={`M-4 ${y}h8m-4 -4v8`} stroke="#526557"/></g>)}
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

function PartsViewerInstance({ kind = "hinge", assembly, activePartIds = EMPTY_PART_IDS, onPartSelect, reviewMode = false, immersive = false, overlay, stageControls }: PartsViewerProps) {
  const parts = assembly ? assembly.parts : PREVIEW_PARTS[kind];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [isolateId, setIsolateId] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(assembly && !assembly.reviewed && !reviewMode ? "This assembly has not been reviewed. Its 3D model is unavailable until review is complete." : null);
  const [ready, setReady] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [partsVisible, setPartsVisible] = useState(true);
  const labelId = useId();
  const controlsId = useId();
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
    setFocusId(null);
    setReady(false);
    setResetKey((key) => key + 1);
    onPartSelect?.(null);
  }
  function retry() {
    if (assembly && !assembly.reviewed && !reviewMode) return;
    setError(null);
    setAvailable(supportsWebGL());
    setReady(false);
    setFocusId(null);
    setResetKey((key) => key + 1);
    setRetryKey((key) => key + 1);
  }
  const selected = parts.find((part) => part.id === selectedId);
  const unknownHighlights = activePartIds.filter((id) => !parts.some((part) => part.id === id));
  const fallback = available === false || !!error;
  const diagramHidden = isolateId ? [...hiddenIds, ...parts.filter((part) => part.id !== isolateId).map((part) => part.id)] : hiddenIds;
  return (
    <section className={`${styles.viewer} ${immersive ? styles.immersive : ""}`} aria-labelledby={immersive ? undefined : labelId} aria-label={immersive ? "Interactive parts viewer" : undefined}>
      {!immersive && <div className={styles.heading}>
        <div className={styles.headingIcon}><Box size={19} strokeWidth={1.5} /></div>
        <div><h3 id={labelId}>A closer look</h3><p>Understand the parts, without taking anything apart.</p></div>
        <span className={styles.interactive}>{fallback ? "PARTS VIEW" : "INTERACTIVE 3D"}</span>
      </div>}
      <div className={styles.stage} role="group" aria-label="Interactive model viewport">
        <div className={styles.modelBadge}><span />{assembly ? assembly.reviewed ? "Reviewed assembly" : reviewMode ? "Unreviewed admin preview — not repair guidance" : "Unreviewed assembly · unavailable" : "Illustrative preview · not a Tripo model"}</div>
        {!assembly && (available !== true || fallback) && <Diagram kind={kind} exploded={exploded} selected={selectedId} hidden={diagramHidden} highlighted={activePartIds}/>}
        {assembly && (available !== true || fallback) && <div className={styles.textFallback}><Box size={40} strokeWidth={1} /><strong>{fallback ? "Explore the labeled parts below" : assembly.reviewed ? "Preparing the reviewed model" : "Preparing an unreviewed admin preview"}</strong><span>No substitute model is shown.</span></div>}
        {available === true && !error && <CanvasBoundary key={retryKey} onError={reportError}>
          <ViewerCanvas kind={kind} assembly={assembly} parts={parts} selectedId={selectedId} hiddenIds={hiddenIds} isolateId={isolateId} exploded={exploded} activePartIds={activePartIds} resetKey={resetKey} focusId={focusId} focusKey={focusKey} onPartSelect={selectPart} onError={reportError} onReady={markReady} />
        </CanvasBoundary>}
        {available === true && !error && !ready && <div className={styles.loading} role="status">Loading {assembly ? assembly.reviewed ? "reviewed model" : "unreviewed admin preview" : "illustrative preview"}…</div>}
        {stageControls && <div className={styles.stageControls}>{stageControls}</div>}
        <div className={styles.stageHint}>{fallback ? "Text alternative · every part is described below" : "Drag to rotate · scroll or pinch to zoom"}</div>
      </div>
      {overlay && <div className={styles.overlay}>{overlay}</div>}
      <div className={styles.controls}>
      {immersive && <button type="button" className={styles.panelToggle} aria-expanded={partsVisible} aria-controls={controlsId} onClick={() => setPartsVisible(current => !current)}>{partsVisible ? "Hide controls" : "Show controls"}</button>}
      <div id={controlsId} hidden={immersive && !partsVisible} className={styles.controlsBody}>
      {fallback && <div className={styles.notice} role={error ? "alert" : "status"}>
        <span>{error || (assembly ? "3D is unavailable in this browser. The labeled part descriptions remain available below." : "3D is unavailable in this browser. The illustrative diagram and labeled part descriptions remain available.")}</span>
        {(!assembly || assembly.reviewed || reviewMode) && <button type="button" onClick={retry}>Retry 3D</button>}
      </div>}
      {assembly && !assembly.reviewed && reviewMode && <p className={styles.notice} role="note">Admin inspection only. Geometry, labels, part mappings, applicability, and usage rights still require approval. This preview does not publish or approve the assembly.</p>}
      {!!unknownHighlights.length && <p className={styles.notice} role="alert">This step references parts that are not mapped in this model. Check the written guide; do not infer a matching component.</p>}
      <div className={styles.toolbar} aria-label="Assembly view controls">
        <button type="button" onClick={() => setExploded((current) => !current)} aria-pressed={exploded} className={exploded ? styles.engaged : ""}><Layers3 size={16} />{exploded ? "Assemble view" : "Explode view"}</button>
        <button type="button" disabled={!selectedId || !ready || fallback} onClick={() => {
          if (!selectedId) return;
          setHiddenIds(current => current.filter(id => id !== selectedId));
          setFocusId(selectedId);
          setFocusKey(key => key + 1);
        }}>Focus part</button>
        <button type="button" onClick={() => {
          if (isolateId) { setIsolateId(null); setHiddenIds([]); }
          else setIsolateId(selectedId);
        }} disabled={!selectedId} aria-pressed={!!isolateId}><Maximize2 size={15} />{isolateId ? "Show all parts" : "Isolate part"}</button>
        <button type="button" className={styles.reset} onClick={reset} aria-label="Reset assembly view"><RotateCcw size={15} /><span>Reset</span></button>
      </div>
      <p className={styles.disclaimer}>Explode view separates the model on screen. Select a part, then isolate it to inspect it alone. This does not authorize taking the real object apart.</p>
      <div className={styles.partsHeading}><span>MEET THE PARTS</span><span>{parts.length} labeled parts</span></div>
      <ul className={styles.partList} aria-label="Assembly parts">
        {parts.map((part, index) => {
          const active = selectedId === part.id;
          const stepActive = activePartIds.includes(part.id);
          const hidden = hiddenIds.includes(part.id) || (!!isolateId && isolateId !== part.id);
          return <li key={part.id} className={`${styles.part} ${active ? styles.selected : ""} ${stepActive ? styles.stepActive : ""}`}>
            <button type="button" className={styles.partSelect} aria-pressed={active} onClick={() => selectPart(part.id)}>
              <span className={styles.partNumber} aria-hidden="true">{active ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</span>
              <span>{part.label}{stepActive && <small>In this step</small>}</span>
              <ChevronRight size={14} className={styles.chevron} />
            </button>
            <button type="button" className={styles.visibility} aria-label={`${hidden ? "Show" : "Hide"} ${part.label}`} aria-pressed={!hidden} onClick={() => {
              if (hidden && isolateId && isolateId !== part.id) {
                setHiddenIds(diagramHidden.filter(id => id !== part.id));
                setIsolateId(null);
              } else setHiddenIds(current => hidden ? current.filter(id => id !== part.id) : [...current, part.id]);
            }}>
              {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            {(active || stepActive || fallback) && <p className={styles.partDescription}>{part.description}</p>}
          </li>;
        })}
      </ul>
      {selected && <p className={styles.selectionStatus} role="status">{selected.label} selected{isolateId ? " · isolated" : ""}{hiddenIds.includes(selected.id) ? " · hidden" : ""}.</p>}
      <p className={styles.disclaimer}>{assembly ? assembly.reviewed ? "A reviewed reference, not a scan of your home." : "An unreviewed asset, not approved repair guidance." : "Generic shapes for exploration, not reviewed repair guidance."} Exploded views explain parts—not safe disassembly or actual dimensions.</p>
      </div>
      </div>
    </section>
  );
}

export default function PartsViewer(props: PartsViewerProps) {
  return <PartsViewerInstance key={`${props.kind ?? "hinge"}:${props.assembly?.url ?? "preview"}:${props.assembly?.reviewed ?? false}:${props.reviewMode ?? false}`} {...props} />;
}
