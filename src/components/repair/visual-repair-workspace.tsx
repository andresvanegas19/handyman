"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, RotateCcw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { messageFromError } from "@/lib/media";
import { fetchPrivateRepairModel } from "@/lib/private-model";
import { isActivePhase, phaseLabels, safeSourceUrl, validateRepairManifest, type PrivateMappedScene, type RepairPipelineState, type RepairSceneManifest, type RepairSolution } from "@/lib/visual-repair";
import styles from "./visual-repair-workspace.module.css";

const PrivateMappedCanvas = dynamic(() => import("../viewer/ViewerCanvas").then(module => module.PrivateMappedCanvas), { ssr: false });
const EMPTY_IDS: string[] = [];

class ModelBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError("The 3D view could not start. Enable WebGL or try another browser. Instructions remain locked."); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function VisualRepairWorkspace({ problemId }: { problemId: Id<"problems"> }) {
  const data = useQuery(api.repairPipeline.get, { problemId });
  const retry = useMutation(api.repairPipeline.retry);
  const start = useMutation(api.repairPipeline.start);
  const remove = useMutation(api.problems.remove);
  const token = useAuthToken();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delayed, setDelayed] = useState(false);
  const phase = data?.phase;
  const noRun = data === null;
  useEffect(() => {
    setDelayed(false);
    if (noRun || phase === "ready" || (phase && !isActivePhase(phase))) return;
    const timer = window.setTimeout(() => setDelayed(true), phase ? 5 * 60_000 : 30_000);
    return () => window.clearTimeout(timer);
  }, [phase, noRun]);
  const retryRun = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (data === null) await start({ problemId }); else await retry({ problemId });
    } catch (error) { setError(messageFromError(error)); }
    finally { setBusy(false); }
  };
  const deleteRepair = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await remove({ problemId }); router.replace("/problems"); }
    catch (error) { setError(messageFromError(error)); setBusy(false); }
  };
  return <VisualRepairWorkspaceView data={data} token={token} delayed={delayed} busy={busy} error={error} onRetry={() => void retryRun()} onDelete={() => void deleteRepair()}/>;
}

export interface VisualRepairWorkspaceViewProps {
  data: RepairPipelineState | null | undefined;
  token: string | null;
  delayed?: boolean;
  busy?: boolean;
  error?: string;
  onRetry: () => void;
  onDelete: () => void;
}

/** Provider-free view; production data and authorization come from the connected wrapper. */
export function VisualRepairWorkspaceView({ data, token, delayed = false, busy = false, error = "", onRetry, onDelete }: VisualRepairWorkspaceViewProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <section className={styles.shell} aria-label="Visual repair workspace">
    <div className={styles.topbar}>
      <Link href="/problems" className="text-link"><ArrowLeft size={16}/>My repairs</Link>
      <span>Private visual repair · AI draft</span>
      <button type="button" className="text-link" onClick={() => setConfirmDelete(value => !value)} disabled={busy}>Delete repair</button>
    </div>
    {confirmDelete && <div className="notice"><div><strong>Delete this repair and its private media?</strong><p>This cannot be undone. Provider retention follows provider policies.</p><button className="button button-danger" disabled={busy} onClick={onDelete}>Delete permanently</button> <button className="button button-secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep repair</button></div></div>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {data?.phase === "ready" && data.scene && data.solution
      ? <ReadyRepair key={`${data.scene.id}:${token ?? "expired"}`} scene={data.scene} solution={data.solution} token={token} cacheHit={data.cacheHit}/>
      : <PipelineProgress data={data} delayed={delayed} busy={busy} onRetry={onRetry}/>}
  </section>;
}

export function PipelineProgress({ data, delayed, busy, onRetry }: { data: RepairPipelineState | null | undefined; delayed: boolean; busy: boolean; onRetry: () => void }) {
  const active = data && isActivePhase(data.phase);
  return <div className={styles.progress}>
    <span className="eyebrow">YOUR PHOTO + PROMPT → MAPPED 3D</span>
    <h1>{data ? phaseLabels[data.phase] : data === null ? "Your repair is saved, but preparation hasn’t started." : delayed ? "We couldn’t reconnect to your repair." : "Connecting to your saved progress…"}</h1>
    {data?.message && <p role={active ? "status" : "alert"}>{data.message}</p>}
    {active && !delayed && <><div className={styles.progressLine} role="status">Work continues securely in the background.</div><p>You can leave and return. We’ll open the workspace automatically only when its solution and mapped model are ready. No separate generation or model-opening step is needed.</p></>}
    {delayed && <p role="alert">This stage is taking longer than expected. Your repair is saved. Check your connection or return later; do not submit another repair to restart a paid task.</p>}
    {data?.phase === "referral" && <p>Stop work. Do not attempt hazardous disassembly. Contact a qualified professional; for immediate danger, move to safety and contact local emergency services.</p>}
    {data?.phase === "needs_input" && <p>No actionable instructions are available. Start a new repair with a clearer close-up and the missing written details.</p>}
    {data?.phase === "ready" && <p role="alert">The saved repair has no complete mapped model and solution. Instructions remain locked.</p>}
    {(data === null || data?.retryable) && <button className="button" disabled={busy} onClick={onRetry}>{busy ? "Requesting retry…" : "Retry repair preparation"}</button>}
    {delayed && <button className="button button-secondary" onClick={() => window.location.reload()}>Reconnect to saved progress</button>}
    {data && !active && data.phase !== "ready" && <Link className="button button-secondary" href="/problems/new">Start with a new photo + description</Link>}
    <p className="small">No repair solution is displayed without a working 3D model. Photo-generated geometry is approximate, not a measured reconstruction.</p>
  </div>;
}

export function ReadyRepair({ scene, solution, token, cacheHit }: { scene: RepairSceneManifest; solution: RepairSolution; token: string | null; cacheHit: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const artifactKey = useMemo(() => JSON.stringify({ scene, solution }), [scene, solution]);
  return <LoadedRepair key={`${artifactKey}:${token ?? "expired"}:${attempt}`} scene={scene} solution={solution} token={token} cacheHit={cacheHit} onRetry={() => setAttempt(value => value + 1)}/>;
}

function LoadedRepair({ scene, solution, token, cacheHit, onRetry }: { scene: RepairSceneManifest; solution: RepairSolution; token: string | null; cacheHit: boolean; onRetry: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const validation = useMemo(() => {
    try { return { parts: validateRepairManifest(scene, solution), error: "" }; }
    catch (error) { return { parts: null, error: messageFromError(error) }; }
  }, [scene, solution]);
  const reportError = useCallback((message: string) => { setError(message); setReady(false); }, []);
  const markReady = useCallback(() => { setReady(true); setFocusKey(value => value + 1); }, []);
  useEffect(() => {
    if (validation.error) return;
    if (!token) { reportError("Your browser session expired. Reconnect before opening this private model."); return; }
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 45_000);
    let cancelled = false;
    let objectUrl: string | undefined;
    fetchPrivateRepairModel(scene.id, token, abort.signal).then(blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(error => {
      if (!cancelled) reportError(abort.signal.aborted ? "The private model download timed out. Check your connection and retry." : messageFromError(error));
    }).finally(() => window.clearTimeout(timer));
    return () => { cancelled = true; window.clearTimeout(timer); abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [scene.id, token, validation.error, reportError]);
  useEffect(() => {
    if (ready || error || validation.error) return;
    const timer = window.setTimeout(() => reportError("The 3D viewer did not become ready. Retry the viewer or use a browser with WebGL enabled."), 80_000);
    return () => window.clearTimeout(timer);
  }, [ready, error, validation.error, reportError]);
  const mappedScene = useMemo<PrivateMappedScene | null>(() => url && validation.parts ? { kind: "private-mapped", url, parts: validation.parts } : null, [url, validation.parts]);
  const step = solution.steps[stepIndex];
  const failure = error || validation.error;
  const unlocked = ready && !failure && !paused;
  const focusIds = unlocked ? step.partIds : EMPTY_IDS;
  const navigate = (index: number) => {
    if (!unlocked || index < 0 || index >= solution.steps.length) return;
    setStepIndex(index); setFocusKey(value => value + 1);
    stepHeading.current?.focus();
  };
  return <div className={styles.workspace} onKeyDown={event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault(); navigate(stepIndex + (event.key === "ArrowRight" ? 1 : -1));
    }
  }}>
    <div className={styles.stage} aria-label="Private mapped 3D model">
      <span className={styles.modelLabel}>{scene.source === "generated" ? "Photo-generated approximate geometry" : "Compatible reference geometry"}{cacheHit ? " · compatible saved result" : ""}</span>
      {mappedScene && !failure && <ModelBoundary onError={reportError}><PrivateMappedCanvas scene={mappedScene} activePartIds={focusIds} focusIds={focusIds} focusKey={focusKey} onError={reportError} onReady={markReady}/></ModelBoundary>}
      {!ready && !failure && <div className={styles.overlay} role="status"><strong>Loading and validating your mapped 3D model…</strong><p>Instructions stay locked until the model is usable.</p></div>}
      {failure && <div className={styles.overlay} role="alert"><strong>3D workspace unavailable</strong><p>{failure}</p><p>No substitute model or text-only repair is shown.</p><button className="button" onClick={onRetry}>Retry 3D viewer</button></div>}
      {ready && !failure && <div className={styles.viewControls}><span>Drag to orbit · pinch or scroll to zoom</span><button className="button button-secondary button-small" disabled={paused} onClick={() => setFocusKey(value => value + 1)}><RotateCcw size={15}/>Refocus step</button></div>}
    </div>
    <aside className={styles.panel} aria-label="Repair instructions">
      {!unlocked && <div className={styles.locked}><h2>{paused ? "Repair paused" : "Instructions are locked"}</h2><p>{paused ? "Stop working if the object, visible parts, or model do not match. Do not infer hidden parts, force, or dimensions. Get qualified help or submit a clearer photo." : "Your private draft appears only after the mapped model has loaded and passed validation."}</p>{paused && <><button className="button button-secondary" onClick={() => { setPaused(false); setFocusKey(value => value + 1); }}>Resume viewing</button><Link href="/problems/new" className="text-link">Start with a clearer photo</Link></>}</div>}
      {unlocked && <>
        <div className={styles.panelHeading}><span className="eyebrow">SOURCE-GROUNDED AI DRAFT · NOT HUMAN REVIEWED</span><h1>{solution.title}</h1><p>{solution.summary}</p></div>
        <button className={styles.drawerToggle} aria-expanded={detailsOpen} aria-controls="repair-step-content" onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? "Hide step details" : "Show step details"} · {stepIndex + 1}/{solution.steps.length}</button>
        <div id="repair-step-content" className={styles.stepContent} hidden={!detailsOpen}>
          <details className={styles.safety} open><summary>Prerequisites & when to stop</summary><ul>{solution.prerequisites.map((item, index) => <li key={`pre-${index}`}>{item}</li>)}{solution.stopConditions.map((item, index) => <li key={`stop-${index}`}><strong>Stop:</strong> {item}</li>)}</ul><p>Never infer hidden mechanisms or safe force from generated geometry.</p></details>
          <label className="field">Repair step<select value={stepIndex} onChange={event => navigate(Number(event.target.value))}>{solution.steps.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}</select></label>
          <div aria-live="polite" aria-atomic="true"><h2 ref={stepHeading} tabIndex={-1}>{stepIndex + 1}. {step.title}</h2><p>{step.description}</p><p className="small">Highlighted: {scene.parts.filter(part => step.partIds.includes(part.id)).map(part => part.label).join(", ")}</p></div>
          <ul className={styles.sources} aria-label="Sources for this step">{solution.sources.filter(source => step.sourceIds.includes(source.id)).map(source => <li key={source.id}><a href={safeSourceUrl(source.url)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title}</a></li>)}</ul>
        </div>
        <nav className={styles.stepNavigation} aria-label="Step navigation"><button className="button button-secondary" disabled={stepIndex === 0} onClick={() => navigate(stepIndex - 1)}><ChevronLeft size={18}/>Previous</button><span>{stepIndex + 1}/{solution.steps.length}</span><button className="button" disabled={stepIndex === solution.steps.length - 1} onClick={() => navigate(stepIndex + 1)}>Next<ChevronRight size={18}/></button></nav>
        <button className={styles.pause} onClick={() => setPaused(true)}><Pause size={16}/>Pause — object or model doesn’t match</button>
      </>}
    </aside>
  </div>;
}
