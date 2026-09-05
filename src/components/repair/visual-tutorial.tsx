"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useId, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ScanSearch, ShieldAlert } from "lucide-react";
import type { Guide, ReviewedAssembly } from "@/lib/domain";
import { PREVIEW_PARTS } from "../viewer/parts";
import GuideArt from "../guide-art";
import styles from "./visual-tutorial.module.css";

const PartsViewer = dynamic(() => import("../viewer/PartsViewer"), {
  ssr: false,
  loading: () => <p role="status">Loading interactive parts...</p>,
});

export default function VisualTutorial(props: { guide: Guide; assembly?: ReviewedAssembly; evidence?: ReactNode }) {
  return <Tutorial key={`${props.guide.slug}:${props.guide.version}:${props.assembly?.url ?? "preview"}`} {...props}/>;
}

function Tutorial({ guide, assembly, evidence }: { guide: Guide; assembly?: ReviewedAssembly; evidence?: ReactNode }) {
  const hasDoorContext = guide.assemblyKind === "hinge" && guide.status === "draft" && !assembly;
  const [wholeDoor, setWholeDoor] = useState(hasDoorContext);
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState<number[]>([]);
  const headingId = useId();
  const step = guide.steps[stepIndex];
  const parts = assembly?.parts ?? (guide.status === "draft" && guide.assemblyKind ? PREVIEW_PARTS[guide.assemblyKind] : []);
  const targets = parts.filter(part => step?.partIds.includes(part.id));
  const unmapped = step?.partIds.some(id => !parts.some(part => part.id === id));
  const selected = (wholeDoor ? PREVIEW_PARTS.door : parts).find(part => part.id === selectedId);
  const complete = guide.steps.length > 0 && completed.length === guide.steps.length;
  const canView = !!assembly || (guide.status === "draft" && !!guide.assemblyKind);
  const relatedSteps = selected ? guide.steps.map((item, index) => ({ item, index })).filter(({ item }) => item.partIds.includes(selected.id)) : [];

  function changeStep(index: number) {
    setStepIndex(index);
    setSelectedId(null);
    setUnderstood(false);
    setWholeDoor(false);
  }

  if (!step) return <div className="notice" role="alert">This guide has no visual checkpoints. Do not infer a repair plan from its model.</div>;

  return <section className={styles.tutorial} aria-labelledby={headingId}>
    <div className={styles.intro}>
      <span className="eyebrow">IDENTIFY FIRST. ACT ONLY WITH VERIFIED GUIDANCE.</span>
      <h2 id={headingId}>One step at a time</h2>
      <p>Compare visible shapes with your object. Separate the model, select a part, and inspect it alone. A matching-looking model is not a diagnosis.</p>
      <p className={styles.reference}>{assembly?.reviewed ? "Reviewed reference model, not a reconstruction of your photo." : guide.status === "draft" ? "Draft visual exploration, not an approved repair tutorial." : "No reviewed 3D model is available for this guide."} Hidden mechanisms, movement directions, and safe force cannot be inferred from geometry.</p>
      <details><summary>Check applicability and stop conditions</summary>
        <h3>Before you begin</h3><ul className="check-list">{guide.prerequisites.map(item => <li key={item}>{item}</li>)}</ul>
        <h3>Stop and get qualified help if...</h3><ul className="check-list">{guide.stopConditions.map(item => <li key={item}>{item}</li>)}</ul>
      </details>
    </div>
    <div className={styles.grid}>
      <div className={styles.instructions}>
        <nav className={styles.stepList} aria-label="Visual tutorial steps">
          {guide.steps.map((item, index) => <button key={index} type="button" aria-current={stepIndex === index ? "step" : undefined} onClick={() => changeStep(index)}>
            <span>{index + 1}</span>{" "}{item.title}{completed.includes(index) && <small>Explored</small>}
          </button>)}
        </nav>
        <article className={styles.checkpoint} aria-label={`Visual checkpoint ${stepIndex + 1}`}>
          <p className={styles.counter}>Step {stepIndex + 1} of {guide.steps.length} · {completed.length} explored</p>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
          <dl className={styles.cues}>
            <div><dt>Where to look</dt><dd>{step.visual?.location ?? (targets.length ? `Find the highlighted ${targets.map(part => part.label.toLowerCase()).join(" and ")} in the reference. Compare visible shapes without touching or removing anything.` : "This checkpoint has no mapped 3D part. Use the written applicability information; do not assume a location.")}</dd></div>
            <div><dt>What to recognize</dt><dd>{step.visual?.lookFor ?? "Use the labeled part descriptions alongside your own visible observations. If the shapes or arrangement differ, pause."}</dd></div>
            <div><dt>Movement and direction</dt><dd>{step.visual?.motion ?? "No movement direction is specified for this checkpoint. Do not infer pulling, twisting, or removal from the 3D animation."}</dd></div>
            <div><dt>Force limit</dt><dd>{step.visual?.force ?? "No safe force is established here. Do not apply force based on this model; use verified instructions for the exact product."}</dd></div>
            <div><dt>What could go wrong</dt><dd>{step.visual?.risk ?? "A different fitting or hidden mechanism could be damaged by an assumed action. Stop if the part, condition, or permitted action is uncertain."}</dd></div>
            <div><dt>Visual checkpoint</dt><dd>{step.visual?.check ?? "Can you explain which visible part this step refers to, and what remains unknown? Understanding the reference does not confirm a repair."}</dd></div>
          </dl>
          {!!targets.length && <p className={styles.targetNames}><strong>{wholeDoor ? "In the hinge close-up:" : "Highlighted now:"}</strong> {targets.map(part => part.label).join(", ")}</p>}
          {unmapped && <p className="notice notice-error" role="alert">A required part is not mapped in the available model. This checkpoint cannot be completed. Use a reviewed matching reference.</p>}
          <label className={styles.confirm}><input type="checkbox" checked={understood} disabled={paused || !!unmapped} onChange={event => setUnderstood(event.target.checked)}/><span>I understand this visual checkpoint and its limits. This is not confirmation that a physical repair is safe or complete.</span></label>
          <div className={styles.actions}>
            <button type="button" className="button button-secondary button-small" disabled={stepIndex === 0} onClick={() => changeStep(stepIndex - 1)}><ArrowLeft size={15}/>Previous</button>
            <button type="button" className="button button-small" disabled={!understood || paused || !!unmapped || complete} onClick={() => {
              setCompleted(current => current.includes(stepIndex) ? current : [...current, stepIndex]);
              if (stepIndex < guide.steps.length - 1) changeStep(stepIndex + 1);
              else setUnderstood(false);
            }}>{stepIndex === guide.steps.length - 1 ? "Finish checkpoint" : "Next checkpoint"}<ArrowRight size={15}/></button>
          </div>
        </article>
        <button type="button" className={styles.uncertain} onClick={() => { setPaused(true); setUnderstood(false); }}><ShieldAlert size={18}/>My object looks different / I&apos;m not sure</button>
        {paused && <div className={styles.pause} role="alert">
          <strong>Pause the physical repair.</strong>
          <p>Do not pull, rotate, or remove an unidentified part. Check the exact make/model and manufacturer documentation, add a clearer photo or question to your repair, or contact a qualified professional. You can still inspect the reference.</p>
          <Link href="/problems" className="text-link">Return to My repairs</Link>
          <button type="button" className="button button-secondary button-small" onClick={() => { setPaused(false); setCompleted([]); changeStep(0); }}>Restart reference-only exploration</button>
        </div>}
        {complete && !paused && <p className={styles.completion} role="status">Visual walkthrough explored. This does not mean your object is repaired, correctly identified, or safe to disassemble.</p>}
      </div>
      <aside className={styles.model} aria-label="Interactive visual reference">
        {evidence && <div className={styles.evidence}><h3>Your visible reference</h3><p>Compare this photo with the model below. No automatic part alignment or exact reconstruction has been performed.</p>{evidence}</div>}
        {hasDoorContext && <div className={styles.contextSwitch}>
          <div role="group" aria-label="Door model views">
            <button type="button" aria-pressed={wholeDoor} onClick={() => { setWholeDoor(true); setSelectedId(null); }}>Whole door</button>
            <button type="button" aria-pressed={!wholeDoor} onClick={() => { setWholeDoor(false); setSelectedId(null); }}>Hinge close-up</button>
          </div>
          <p>{wholeDoor ? "Find the highlighted hinges on the whole door. Switch to Hinge close-up to separate the leaves, pin, and screws." : "Explore a generic hinge separately. This is a reference detail, not a scan of your door."}</p>
        </div>}
        {canView ? <PartsViewer key={`${stepIndex}:${wholeDoor}`} kind={wholeDoor ? "door" : guide.assemblyKind} assembly={assembly} activePartIds={wholeDoor ? ["door-hinges"] : step.partIds} onPartSelect={setSelectedId}/> : <>
          <GuideArt slug={guide.slug} large/>
          <p className="notice">No mapped 3D reference is available for this guide. No reconstructed model or hidden parts are being substituted.</p>
        </>}
        <div className={styles.selection} aria-live="polite">
          <ScanSearch size={21}/>
          <div>{selected ? <><strong>{selected.label}</strong><p>{selected.description}</p>
            {wholeDoor && selected.id === "door-hinges" ? <div className={styles.related}><button type="button" onClick={() => { setWholeDoor(false); setSelectedId(null); }}>Inspect hinge parts</button></div> : relatedSteps.length ? <div className={styles.related}>{relatedSteps.map(({ item, index }) => <button key={index} type="button" onClick={() => changeStep(index)}>Show step {index + 1}: {item.title}</button>)}</div> : <p>This part is not referenced by a tutorial step.</p>}
          </> : <><strong>Which part is this?</strong><p>Select a shape or its label to connect it to the relevant steps. Explode view separates the illustration; Isolate part shows only your selection.</p></>}</div>
        </div>
      </aside>
    </div>
  </section>;
}
