"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, Pause, RotateCcw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { messageFromError } from "@/lib/media";
import { fetchPrivateRepairModel } from "@/lib/private-model";
import { repairErrorCode, repairLog } from "@/lib/repair-log";
import { isActivePhase, phaseLabels, safeSourceUrl, validateRepairManifest, type PrivateMappedScene, type RepairPipelineState, type RepairRecommendations, type RepairSceneManifest, type RepairSolution, type ViewerFailureCode } from "@/lib/visual-repair";
import styles from "./visual-repair-workspace.module.css";

const PrivateMappedCanvas = dynamic(() => import("../viewer/ViewerCanvas").then(module => module.PrivateMappedCanvas), { ssr: false });
const PreviewCanvas = dynamic(() => import("../viewer/SceneCanvas"), { ssr: false });
const EMPTY_IDS: string[] = [];
type ViewerFailureCallback = (code: ViewerFailureCode, sceneId?: string) => void;

function useFailureReporter(sceneId: string | undefined, onViewerFailure?: ViewerFailureCallback) {
  const reported = useRef(new Set<ViewerFailureCode>());
  const callback = useRef(onViewerFailure);
  useEffect(() => { callback.current = onViewerFailure; }, [onViewerFailure]);
  return useCallback((code: ViewerFailureCode) => {
    if (reported.current.has(code)) return;
    reported.current.add(code);
    repairLog("viewer.failed", { sceneId, code }, "error");
    callback.current?.(code, sceneId);
  }, [sceneId]);
}

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
  const cancel = useMutation(api.repairPipeline.cancel);
  const remove = useMutation(api.problems.remove);
  const reportViewerFailure = useMutation(api.repairPipeline.reportViewerFailure);
  const token = useAuthToken();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diagnosticError, setDiagnosticError] = useState("");
  const diagnosticVersion = useRef(0);
  const onViewerReady = useCallback(() => {
    diagnosticVersion.current++;
    setDiagnosticError("");
  }, []);
  const onViewerFailure = useCallback((code: ViewerFailureCode, sceneId?: string) => {
    const version = ++diagnosticVersion.current;
    setDiagnosticError("");
    void reportViewerFailure({ problemId, ...(sceneId ? { sceneId } : {}), code }).catch(() => {
      repairLog("viewer.diagnostic.failed", { problemId, sceneId, code }, "error");
      if (diagnosticVersion.current === version) setDiagnosticError("Diagnostic submission failed. The 3D error remains unresolved; reconnect to your account and retry the viewer to submit diagnostics again.");
    });
  }, [problemId, reportViewerFailure]);
  const [delayed, setDelayed] = useState(false);
  const phase = data?.phase;
  const noRun = data === null;
  const cacheHit = data?.cacheHit;
  const retryable = data?.retryable;
  const sceneId = data?.scene?.id;
  useEffect(() => {
    repairLog("pipeline.state", { problemId, phase: phase ?? (noRun ? "not_started" : "connecting"), cacheHit, retryable, sceneId });
  }, [problemId, phase, noRun, cacheHit, retryable, sceneId]);
  useEffect(() => {
    setDelayed(false);
    if (noRun || phase === "ready" || (phase && !isActivePhase(phase))) return;
    const timer = window.setTimeout(() => setDelayed(true), phase ? 5 * 60_000 : 30_000);
    return () => window.clearTimeout(timer);
  }, [phase, noRun]);
  const retryRun = async () => {
    if (busy) return;
    setBusy(true); setError("");
    repairLog("pipeline.retry.requested", { problemId });
    try {
      if (data === null) await start({ problemId }); else await retry({ problemId });
    } catch (error) { repairLog("pipeline.retry.failed", { problemId, code: repairErrorCode(error) }, "error"); setError(messageFromError(error)); }
    finally { setBusy(false); }
  };
  const deleteRepair = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await remove({ problemId }); router.replace("/problems"); }
    catch (error) { setError(messageFromError(error)); setBusy(false); }
  };
  const stopMismatchedRepair = async () => {
    setBusy(true); setError("");
    repairLog("pipeline.cancel.requested", { problemId });
    try { await cancel({ problemId }); repairLog("pipeline.cancel.completed", { problemId }); }
    catch (error) { repairLog("pipeline.cancel.failed", { problemId, code: repairErrorCode(error) }, "error"); setError(`The repair remains paused here, but stopping the saved run failed: ${messageFromError(error)}`); }
    finally { setBusy(false); }
  };
  return <VisualRepairWorkspaceView data={data} token={token} delayed={delayed} busy={busy} error={error} diagnosticError={diagnosticError} onViewerFailure={onViewerFailure} onViewerReady={onViewerReady} onRetry={() => void retryRun()} onDelete={() => void deleteRepair()} onMismatch={() => void stopMismatchedRepair()}/>;
}

export interface VisualRepairWorkspaceViewProps {
  data: RepairPipelineState | null | undefined;
  token: string | null;
  delayed?: boolean;
  busy?: boolean;
  error?: string;
  diagnosticError?: string;
  onViewerFailure?: ViewerFailureCallback;
  onViewerReady?: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onMismatch?: () => void;
}

/** Provider-free view; production data and authorization come from the connected wrapper. */
export function VisualRepairWorkspaceView({ data, token, delayed = false, busy = false, error = "", diagnosticError = "", onViewerFailure, onViewerReady, onRetry, onDelete, onMismatch }: VisualRepairWorkspaceViewProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <section className={styles.shell} aria-label="Visual repair workspace">
    <div className={styles.topbar}>
      <Link href="/problems" className="text-link"><ArrowLeft size={16}/>My repairs</Link>
      <span>Private visual repair · AI draft</span>
      <button type="button" className="text-link" onClick={() => setConfirmDelete(value => !value)} disabled={busy}>Delete repair</button>
    </div>
    {confirmDelete && <div className="notice"><div><strong>Delete this repair and its private media?</strong><p>This cannot be undone. Provider retention follows provider policies.</p><button className="button button-danger" disabled={busy} onClick={onDelete}>Delete permanently</button> <button className="button button-secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep repair</button></div></div>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {diagnosticError && <p className="notice notice-error" role="alert">{diagnosticError}</p>}
    {data?.phase === "ready" && data.preview
      ? <ReadyPreview key={`${data.preview.id}:${token ?? "expired"}`} sceneId={data.preview.id} recommendations={data.recommendations} token={token} cacheHit={data.cacheHit} onViewerFailure={onViewerFailure} onViewerReady={onViewerReady}/>
      : data?.phase === "ready" && data.scene && data.solution
      ? <ReadyRepair key={`${data.scene.id}:${token ?? "expired"}`} scene={data.scene} solution={data.solution} recommendations={data.recommendations} token={token} cacheHit={data.cacheHit} onMismatch={onMismatch} onViewerFailure={onViewerFailure} onViewerReady={onViewerReady}/>
      : <PipelineProgress key={data?.phase ?? "connecting"} data={data} token={token} delayed={delayed} busy={busy} onRetry={onRetry} onViewerFailure={onViewerFailure}/>}
  </section>;
}

export function ReadyPreview(props: {
  sceneId: string; token: string | null; cacheHit: boolean; recommendations?: RepairRecommendations;
  onViewerFailure?: ViewerFailureCallback; onViewerReady?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  return <LoadedPreview key={`${props.sceneId}:${props.token ?? "expired"}:${attempt}`} {...props} onRetry={() => setAttempt(value => value + 1)}/>;
}

function LoadedPreview({ sceneId, token, cacheHit, recommendations, onViewerFailure, onViewerReady, onRetry }: {
  sceneId: string; token: string | null; cacheHit: boolean; recommendations?: RepairRecommendations;
  onViewerFailure?: ViewerFailureCallback; onViewerReady?: () => void; onRetry: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const reportFailure = useFailureReporter(sceneId, onViewerFailure);
  const fail = useCallback((message: string, code: ViewerFailureCode = "render_failed") => {
    setError(message); setReady(false); reportFailure(code);
  }, [reportFailure]);
  const markReady = useCallback(() => {
    setReady(true);
    repairLog("viewer.ready", { sceneId, workflow: "preview" });
    onViewerReady?.();
  }, [sceneId, onViewerReady]);
  useEffect(() => {
    if (!token) { fail("Your session expired. Reconnect before opening this private preview.", "session_expired"); return; }
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 45_000);
    let disposed = false;
    let objectUrl: string | undefined;
    fetchPrivateRepairModel(sceneId, token, abort.signal).then(blob => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(error => {
      if (!disposed) fail(abort.signal.aborted ? "The private model download timed out. Retry the preview." : messageFromError(error), abort.signal.aborted ? "download_timeout" : "download_failed");
    }).finally(() => window.clearTimeout(timer));
    return () => { disposed = true; window.clearTimeout(timer); abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [sceneId, token, fail]);
  useEffect(() => {
    if (ready || error) return;
    const timer = window.setTimeout(() => fail("The 3D viewer did not become ready. Retry with WebGL enabled.", "render_timeout"), 80_000);
    return () => window.clearTimeout(timer);
  }, [ready, error, fail]);
  return <div className={styles.workspace}>
    <div className={styles.stage} aria-label="Private 3D visual preview">
      <span className={styles.modelLabel}>AI-generated approximate geometry{cacheHit ? " · saved private model" : ""}</span>
      {url && !error && <ModelBoundary onError={fail}><PreviewCanvas url={url} fill resetKey={resetKey} onError={fail} onReady={markReady}/></ModelBoundary>}
      {!ready && !error && <div className={styles.overlay} role="status"><LoaderCircle className={styles.spinner} size={32} aria-hidden="true"/><strong>Loading your 3D visual preview…</strong></div>}
      {error && <div className={styles.overlay} role="alert"><strong>3D preview unavailable</strong><p>{error}</p><button className="button" onClick={onRetry}>Retry 3D viewer</button></div>}
      {ready && !error && <div className={styles.viewControls}><span>Drag to rotate · pinch or scroll to zoom</span><button className="button button-secondary button-small" onClick={() => setResetKey(value => value + 1)}><RotateCcw size={15}/>Reset view</button></div>}
    </div>
    <aside className={styles.panel} aria-label="3D preview context">
      <div className={styles.panelHeading}><span className="eyebrow">VISUAL PREVIEW · NOT A REPAIR GUIDE</span><h1>{error ? "Preview could not open" : ready ? "Your 3D visual preview" : "Preparing the 3D view"}</h1>
        <p>This model helps you examine the uploaded scene. It does not verify hidden parts, dimensions, damage, or safe repair actions.</p>
      </div>
      {recommendations && token && <Recommendations recommendations={recommendations}/>}
      <p className="notice" role="note">Verified repair steps and component highlights are not available for this preview. Do not use generated geometry as disassembly instructions.</p>
      {url && <a className="button button-secondary" href={url} download="uploaded-object.glb">Download 3D model (GLB)</a>}
    </aside>
  </div>;
}

function RecognitionContext({ recommendations }: { recommendations: RepairRecommendations }) {
  const { identification, visionModel, imageDescription, visibleFeatures } = recommendations;
  return <>
    {visionModel && (imageDescription || Boolean(visibleFeatures?.length)) && <section className={styles.identification} aria-label="Image description">
      <h2>What the AI sees in your photo</h2>
      <p className="small">AI-generated visual description, not a diagnosis or repair instructions. It may miss or misidentify details.</p>
      {imageDescription && <p>{imageDescription}</p>}
      {Boolean(visibleFeatures?.length) && <><h3>Visible objects and features</h3><ul>{visibleFeatures?.map((feature, index) => <li key={index}>{feature}</li>)}</ul></>}
    </section>}
    {recommendations.urgent && <div className={styles.urgent} role="alert">
      <strong>Stop work. Do not attempt hazardous disassembly. If there is immediate danger, move to safety and contact local emergency services.</strong>
      <p>{recommendations.summary}</p>
    </div>}
    {identification && <div className={styles.identification}>
      <h3>Tentative object identification</h3>
      <p>AI estimate · unconfirmed. Check these details against the object’s label before relying on product documentation.</p>
      <dl>
        <div><dt>Object</dt><dd>{identification.product || "Not identified"}</dd></div>
        <div><dt>Brand</dt><dd>{identification.brand || "Not identified"}</dd></div>
        <div><dt>Model</dt><dd>{identification.model || "Not identified"}</dd></div>
        <div><dt>AI confidence</dt><dd>{Number.isFinite(identification.confidence) && identification.confidence >= 0 && identification.confidence <= 1 ? `${Math.round(identification.confidence * 100)}%` : "Unavailable"} · not a guarantee</dd></div>
      </dl>
    </div>}
    {visionModel && <p className="small">Image recognition via OpenRouter · AI model: <span className={styles.modelName}>{visionModel}</span> · results unconfirmed</p>}
  </>;
}

function Recommendations({ recommendations }: { recommendations: RepairRecommendations }) {
  const sources = recommendations.sources.flatMap(source => {
    const url = safeSourceUrl(source.url);
    return url ? [{ ...source, url }] : [];
  });
  return <section className={styles.recommendations} aria-label="Repair recommendations">
    <span className="eyebrow">AI ADVISORY · NOT HUMAN REVIEWED</span>
    <h2>Safe next steps for your problem</h2>
    {!recommendations.urgent && <p>{recommendations.summary}</p>}
    <RecognitionContext recommendations={recommendations}/>
    {recommendations.items.length > 0 && <ul className={styles.recommendationItems}>{recommendations.items.map((item, index) => <li key={index}><h3>{item.title}</h3><p>{item.description}</p></li>)}</ul>}
    {sources.length > 0 && <div><h3>Documentation to check</h3><ul className={styles.sources} aria-label="Recommendation sources">{sources.map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title}</a></li>)}</ul></div>}
    {recommendations.questions.length > 0 && <div><h3>Details that would help next</h3><ul className={styles.questions}>{recommendations.questions.map((question, index) => <li key={index}>{question}</li>)}</ul><Link href="/problems/new" className="text-link">Add these details in a new repair</Link><p className="small">Only take another photo if it is safe; do not disassemble the object to answer.</p></div>}
    <p className="small">Safe next steps, questions, and source information are usable before 3D. Interactive repair steps require a validated model ready in your browser. References do not confirm your exact model or compatible parts; generated geometry is approximate.</p>
  </section>;
}

export function PipelineProgress({ data, token = null, delayed, busy, onRetry, onViewerFailure }: { data: RepairPipelineState | null | undefined; token?: string | null; delayed: boolean; busy: boolean; onRetry: () => void; onViewerFailure?: ViewerFailureCallback }) {
  const active = data && isActivePhase(data.phase);
  const loading = data === undefined || Boolean(active);
  const recommendations = data?.phase !== "cancelled" && (data?.phase !== "ready" || token) ? data?.recommendations : undefined;
  const analyzeSavedPhoto = (data?.phase === "referral" || data?.phase === "needs_input") && data.retryable && !recommendations?.visionModel;
  const malformedReady = data?.phase === "ready";
  const reportFailure = useFailureReporter(data?.scene?.id, onViewerFailure);
  useEffect(() => { if (malformedReady) reportFailure("model_missing"); }, [malformedReady, reportFailure]);
  return <div className={styles.progress}>
    <div aria-busy={loading}>
    {loading && <LoaderCircle className={styles.spinner} size={32} aria-hidden="true"/>}
    <span className="eyebrow">YOUR PHOTO + PROBLEM · AI ASSESSMENT</span>
    <h1>{malformedReady ? "Interactive repair model unavailable" : data ? phaseLabels[data.phase] : data === null ? "Your repair is saved, but preparation hasn’t started." : delayed ? "We couldn’t reconnect to your repair." : "Connecting to your saved progress…"}</h1>
    {data?.message && data.message !== phaseLabels[data.phase] && <p role={active ? "status" : "alert"}>{data.message}</p>}
    {malformedReady && <p>The mapped guide is incomplete. Interactive repair steps remain locked.</p>}
    {delayed && <p role="alert">This stage is taking longer than expected. Your repair is saved. Check your connection or return later; do not submit another repair to restart a paid task.</p>}
    </div>
    {recommendations && <Recommendations recommendations={recommendations}/>}
    {data?.phase === "referral" && !recommendations && <p>Stop work. Do not attempt hazardous disassembly. Contact a qualified professional; for immediate danger, move to safety and contact local emergency services.</p>}
    {data?.phase === "needs_input" && !recommendations && <p>Describe what went wrong and any error already visible. Add a clearer photo only if it is safe; do not disassemble the object to gather details.</p>}
    {(data === null || data?.retryable) && <button className="button" disabled={busy} onClick={onRetry}>{busy ? "Requesting retry…" : analyzeSavedPhoto ? "Analyze saved photo" : "Retry repair preparation"}</button>}
    {delayed && <button className="button button-secondary" onClick={() => window.location.reload()}>Reconnect to saved progress</button>}
    {data && !active && data.phase !== "ready" && <Link className="button button-secondary" href="/problems/new">Start with a new photo + description</Link>}
    {!recommendations && data?.phase !== "cancelled" && <p className="small">Safe next steps and source information will appear here when available, without waiting for 3D. Interactive repair steps require a validated model ready in your browser.</p>}
  </div>;
}

export function ReadyRepair({ scene, solution, recommendations, token, cacheHit, onMismatch, onViewerFailure, onViewerReady }: { scene: RepairSceneManifest; solution: RepairSolution; recommendations?: RepairRecommendations; token: string | null; cacheHit: boolean; onMismatch?: () => void; onViewerFailure?: ViewerFailureCallback; onViewerReady?: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const artifactKey = useMemo(() => JSON.stringify({ scene, solution }), [scene, solution]);
  return <LoadedRepair key={`${artifactKey}:${token ?? "expired"}:${attempt}`} scene={scene} solution={solution} recommendations={recommendations} token={token} cacheHit={cacheHit} onRetry={() => setAttempt(value => value + 1)} onMismatch={onMismatch} onViewerFailure={onViewerFailure} onViewerReady={onViewerReady}/>;
}

function LoadedRepair({ scene, solution, recommendations, token, cacheHit, onRetry, onMismatch, onViewerFailure, onViewerReady }: { scene: RepairSceneManifest; solution: RepairSolution; recommendations?: RepairRecommendations; token: string | null; cacheHit: boolean; onRetry: () => void; onMismatch?: () => void; onViewerFailure?: ViewerFailureCallback; onViewerReady?: () => void }) {
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
  const reportFailure = useFailureReporter(scene.id, onViewerFailure);
  const reportError = useCallback((message: string, code: ViewerFailureCode = "render_failed") => {
    reportFailure(code);
    setError(message); setReady(false);
  }, [reportFailure]);
  const markReady = useCallback(() => {
    repairLog("viewer.ready", { sceneId: scene.id });
    setReady(true); setFocusKey(value => value + 1);
    onViewerReady?.();
  }, [scene.id, onViewerReady]);
  useEffect(() => {
    if (validation.error) { reportFailure("manifest_invalid"); return; }
    repairLog("viewer.manifest.valid", { sceneId: scene.id });
    if (!token) { reportError("Your browser session expired. Reconnect before opening this private model.", "session_expired"); return; }
    const abort = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      abort.abort();
      reportError("The private model download timed out. Check your connection and retry.", "download_timeout");
    }, 45_000);
    let objectUrl: string | undefined;
    fetchPrivateRepairModel(scene.id, token, abort.signal).then(blob => {
      if (cancelled || abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(error => {
      if (!cancelled && !abort.signal.aborted) reportError(messageFromError(error), "download_failed");
    }).finally(() => window.clearTimeout(timer));
    return () => { cancelled = true; window.clearTimeout(timer); abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [scene.id, token, validation.error, reportError, reportFailure]);
  useEffect(() => {
    if (ready || error || validation.error) return;
    const timer = window.setTimeout(() => reportError("The 3D viewer did not become ready. Retry the viewer or use a browser with WebGL enabled.", "render_timeout"), 80_000);
    return () => window.clearTimeout(timer);
  }, [ready, error, validation.error, reportError]);
  const mappedScene = useMemo<PrivateMappedScene | null>(() => url && validation.parts ? { kind: "private-mapped", url, parts: validation.parts } : null, [url, validation.parts]);
  const step = solution.steps[stepIndex];
  const failure = error || validation.error;
  const unlocked = ready && !failure && !paused && Boolean(token) && Boolean(step);
  const focusIds = unlocked ? step.partIds : EMPTY_IDS;
  useEffect(() => {
    if (unlocked) repairLog("viewer.step.focus", { sceneId: scene.id, step: stepIndex + 1, count: step.partIds.length, attempt: focusKey });
  }, [unlocked, scene.id, stepIndex, step?.partIds.length, focusKey]);
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
      {!ready && !failure && <div className={styles.overlay} role="status"><LoaderCircle className={styles.spinner} size={32} aria-hidden="true"/><strong>Loading and validating your mapped 3D model…</strong><p>Instructions stay locked until the model is usable.</p></div>}
      {failure && <div className={styles.overlay} role="alert"><strong>Interactive repair model unavailable</strong><p>{failure}</p><p>Interactive repair steps remain locked until the model is usable.</p><button className="button" disabled={paused && Boolean(onMismatch)} onClick={onRetry}>Retry 3D viewer</button></div>}
      {ready && !failure && <div className={styles.viewControls}><span>Drag to orbit · pinch or scroll to zoom</span><button className="button button-secondary button-small" disabled={paused} onClick={() => setFocusKey(value => value + 1)}><RotateCcw size={15}/>Refocus step</button></div>}
    </div>
    <aside className={styles.panel} aria-label="Repair instructions">
      {unlocked && <div className={styles.panelHeading}><span className="eyebrow">SOURCE-GROUNDED AI DRAFT · NOT HUMAN REVIEWED</span><h1>{solution.title}</h1><p>{solution.summary}</p></div>}
      {!paused && token && recommendations && <Recommendations recommendations={recommendations}/>}
      {!unlocked && <div className={styles.locked}><h2>{paused ? "Repair paused" : "Interactive repair steps are locked"}</h2><p>{paused ? "Stop working if the object, visible parts, or model do not match. Do not infer hidden parts, force, or dimensions. Get qualified help or submit a clearer photo." : "Mapped hands-on instructions appear only after the model has loaded and passed validation."}</p>{paused && <>{!onMismatch && <button className="button button-secondary" onClick={() => { setPaused(false); setFocusKey(value => value + 1); }}>Resume viewing</button>}<Link href="/problems/new" className="text-link">Start with a clearer photo</Link></>}</div>}
      {unlocked && <>
        <button className={styles.drawerToggle} aria-expanded={detailsOpen} aria-controls="repair-step-content" onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? "Hide step details" : "Show step details"} · {stepIndex + 1}/{solution.steps.length}</button>
        <div id="repair-step-content" className={styles.stepContent} hidden={!detailsOpen}>
          <details className={styles.safety} open><summary>Prerequisites & when to stop</summary><ul>{solution.prerequisites.map((item, index) => <li key={`pre-${index}`}>{item}</li>)}{solution.stopConditions.map((item, index) => <li key={`stop-${index}`}><strong>Stop:</strong> {item}</li>)}</ul><p>Never infer hidden mechanisms or safe force from generated geometry.</p></details>
          <label className="field">Repair step<select value={stepIndex} onChange={event => navigate(Number(event.target.value))}>{solution.steps.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}</select></label>
          <div aria-live="polite" aria-atomic="true"><h2 ref={stepHeading} tabIndex={-1}>{stepIndex + 1}. {step.title}</h2><p>{step.description}</p><p className="small">Highlighted: {scene.parts.filter(part => step.partIds.includes(part.id)).map(part => part.label).join(", ")}</p></div>
          <ul className={styles.sources} aria-label="Sources for this step">{solution.sources.filter(source => step.sourceIds.includes(source.id)).map(source => <li key={source.id}><a href={safeSourceUrl(source.url)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title}</a></li>)}</ul>
        </div>
        <nav className={styles.stepNavigation} aria-label="Step navigation"><button className="button button-secondary" disabled={stepIndex === 0} onClick={() => navigate(stepIndex - 1)}><ChevronLeft size={18}/>Previous</button><span>{stepIndex + 1}/{solution.steps.length}</span><button className="button" disabled={stepIndex === solution.steps.length - 1} onClick={() => navigate(stepIndex + 1)}>Next<ChevronRight size={18}/></button></nav>
        <button className={styles.pause} onClick={() => { setPaused(true); onMismatch?.(); }}><Pause size={16}/>Pause — object or model doesn’t match</button>
      </>}
    </aside>
  </div>;
}
