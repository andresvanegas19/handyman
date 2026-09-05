"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, ClipboardList, Trash2 } from "lucide-react";
import type { Outcome } from "@/lib/domain";
import { STARTER_GUIDES } from "@/lib/catalog";
import { messageFromError } from "@/lib/media";
import type { TemporaryAttachment, TemporaryRepair, TemporaryRating } from "@/lib/temporary-storage";
import IntakeForm from "./intake/intake-form";
import { TemporaryStorageGate, TemporaryStorageNotice, useTemporaryStore } from "./temporary-store";
import VisualTutorial from "./repair/visual-tutorial";
import RepairPipeline from "./repair/repair-pipeline";

export function TemporaryIntake() {
  const store = useTemporaryStore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <TemporaryStorageGate><IntakeForm storageMode="temporary" busy={busy} onSubmit={async input => {
    if (busy) return;
    setBusy(true);
    try {
      const id = store.createRepair(input);
      router.push(`/problems/${id}`);
    } catch (error) {
      setBusy(false);
      throw error;
    }
  }}/></TemporaryStorageGate>;
}

export function TemporaryHistory() {
  const store = useTemporaryStore();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  return <><TemporaryStorageNotice/><TemporaryStorageGate>
    {!store.data.repairs.length
      ? <div className="empty-state"><ClipboardList size={36}/><h2>A fresh start for your small fixes.</h2>
        <p>Save a description, photo, or voice note in this tab. No account or backend setup needed.</p>
        <Link className="button" href="/problems/new">Describe a problem <ArrowUpRight size={16}/></Link></div>
      : <div className="history-list">{store.data.repairs.map(repair => <article className="history-card" key={repair.id}>
        <div><span className="eyebrow">{new Date(repair.createdAt).toLocaleDateString()}</span>
          <h2><Link href={`/problems/${repair.id}`}>{(repair.text || "A photo or voice-note repair").slice(0, 110)}</Link></h2>
          <span className="status-badge">Saved in this tab</span>
          <p>{repair.attachments.length} attachment{repair.attachments.length === 1 ? "" : "s"} · Not analyzed by AI</p>
        </div>
        <Link className="button button-secondary" href={`/problems/${repair.id}`}>Open <ArrowUpRight size={16}/></Link>
      </article>)}</div>}
    {(store.data.repairs.length > 0 || store.data.ratings.length > 0) && <div className="workspace-section">
      <button className="button button-secondary" onClick={() => setConfirm(true)}>Clear this tab&apos;s saved data</button>
      {confirm && <><p>Remove all temporary repairs, attachments, and guide feedback from this tab?</p>
        <button className="button button-danger" onClick={() => {
          try { store.clear(); setConfirm(false); } catch (error) { setError(messageFromError(error)); }
        }}>Confirm clear</button>
        <button className="button button-secondary" onClick={() => setConfirm(false)}>Keep data</button></>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </TemporaryStorageGate></>;
}

export function TemporaryWorkspace({ id }: { id: string }) {
  const store = useTemporaryStore();
  const repair = store.data.repairs.find(item => item.id === id);
  return <><Link className="breadcrumbs" href="/problems"><ArrowLeft size={16}/>Back to My repairs</Link>
    <h1>Your temporary repair.</h1><TemporaryStorageNotice/><TemporaryStorageGate>
      {repair ? <TemporaryRepairForm key={repair.id} repair={repair}/> : <div className="empty-state">
        <h2>This repair isn&apos;t in this tab.</h2><p>It may have been deleted or created in a different tab. Temporary repairs do not sync between browsers.</p>
        <Link className="button" href="/problems/new">Start a repair</Link>
      </div>}
    </TemporaryStorageGate></>;
}

function LocalAttachment({ attachment }: { attachment: TemporaryAttachment }) {
  const store = useTemporaryStore();
  const file = store.getFile(attachment.id);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <div className="workspace-section">
    <strong>{attachment.name}</strong>
    {!file && <p className="small">This attachment cleared on refresh. Only its name remains; its contents were never uploaded.</p>}
    {url && (attachment.kind === "photo"
      ? <Image src={url} alt={`Temporary repair photo: ${attachment.name}`} width={460} height={300} unoptimized style={{ display: "block", maxWidth: "100%", height: "auto", borderRadius: 10, marginTop: 12 }}/>
      : <audio src={url} controls aria-label={`Voice note: ${attachment.name}`} style={{ width: "100%", marginTop: 12 }}/>)}
  </div>;
}

function TemporaryRepairForm({ repair }: { repair: TemporaryRepair }) {
  const store = useTemporaryStore();
  const router = useRouter();
  const [text, setText] = useState(repair.text);
  const [notes, setNotes] = useState(repair.notes);
  const [slug, setSlug] = useState(repair.selectedGuideSlug ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = STARTER_GUIDES.find(guide => guide.slug === slug);

  function save() {
    store.updateRepair(repair.id, { text, notes, selectedGuideSlug: slug || undefined });
    setSaved(true);
    setError("");
  }

  return <>
    <RepairPipeline hasPhoto={repair.attachments.some(attachment => attachment.kind === "photo" && !!store.getFile(attachment.id))} assessed={false} hasPlan={false} hasModel={false} guiding={!!selected} temporary/>
    <div className="notice"><div><strong>Saved input, not a diagnosis</strong>
      <p>This browser-only MVP does not transcribe audio, diagnose photos, or call AI. You can listen to your note, add details, and explore draft catalog examples manually. For hazards or uncertainty, contact a qualified professional.</p>
    </div></div>
    {repair.attachments.filter(attachment => !selected || attachment.kind !== "photo").map(attachment => <LocalAttachment key={attachment.id} attachment={attachment}/>)}
    <form className="workspace-section" onSubmit={event => {
      event.preventDefault();
      try { save(); } catch (error) { setError(messageFromError(error)); }
    }}>
      <h2>What you noticed</h2>
      <div className="field"><label htmlFor="temporary-description">Description</label>
        <textarea id="temporary-description" maxLength={4000} value={text} onChange={event => { setText(event.target.value); setSaved(false); }}/></div>
      <div className="field"><label htmlFor="temporary-notes">Your notes <span>(optional)</span></label>
        <textarea id="temporary-notes" maxLength={8000} value={notes} onChange={event => { setNotes(event.target.value); setSaved(false); }} placeholder="Add what you heard in the recording, what changed, or questions for a professional."/></div>
      <div className="field"><label htmlFor="temporary-guide">Choose a catalog example to explore</label>
        <select id="temporary-guide" value={slug} onChange={event => { setSlug(event.target.value); setSaved(false); }}>
          <option value="">Choose an example — not an AI recommendation</option>
          {STARTER_GUIDES.map(guide => <option key={guide.slug} value={guide.slug}>{guide.title}</option>)}
        </select>
      </div>
      <div className="form-actions"><button className="button">Save changes</button>
        {selected && <button type="button" className="button button-secondary" onClick={() => {
          try { save(); router.push(`/catalog/${selected.slug}`); } catch (error) { setError(messageFromError(error)); }
        }}>Open selected example <ArrowUpRight size={16}/></button>}
      </div>
      {saved && <p className="status-message" role="status">Saved in this tab.</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </form>
    {selected && <>
      <VisualTutorial guide={selected} evidence={repair.attachments.some(attachment => attachment.kind === "photo") ? repair.attachments.filter(attachment => attachment.kind === "photo").map(attachment => <LocalAttachment key={attachment.id} attachment={attachment}/>) : undefined}/>
      <TemporaryGuideFeedback slug={selected.slug} version={selected.version}/>
    </>}
    <div className="workspace-section">
      <button className="button button-secondary" onClick={() => setConfirmDelete(true)}><Trash2 size={16}/>Delete temporary repair</button>
      {confirmDelete && <><p>Delete this repair and its in-memory attachments? Guide feedback is separate and can be cleared from My repairs.</p>
        <button className="button button-danger" onClick={() => {
          try { store.removeRepair(repair.id); router.replace("/problems"); } catch (error) { setError(messageFromError(error)); }
        }}>Delete permanently</button>
        <button className="button button-secondary" onClick={() => setConfirmDelete(false)}>Keep repair</button></>}
    </div>
  </>;
}

export function TemporaryGuideFeedback({ slug, version }: { slug: string; version: number }) {
  const store = useTemporaryStore();
  const previous = store.data.ratings.find(rating => rating.slug === slug && rating.version === version);
  return <TemporaryStorageGate><TemporaryFeedbackForm key={`${slug}:${version}`} slug={slug} version={version} previous={previous}/></TemporaryStorageGate>;
}

function TemporaryFeedbackForm({ slug, version, previous }: { slug: string; version: number; previous?: TemporaryRating }) {
  const store = useTemporaryStore();
  const [outcome, setOutcome] = useState<Outcome | undefined>(previous?.outcome);
  const [comment, setComment] = useState(previous?.comment ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  return <form className="feedback-panel" onSubmit={event => {
    event.preventDefault();
    if (!outcome) { setError("Choose an outcome first."); return; }
    try { store.saveRating({ slug, version, outcome, comment }); setSaved(true); setError(""); }
    catch (error) { setError(messageFromError(error)); }
  }}>
    <h2>How did it go?</h2>
    <p className="small">Feedback on this draft stays only in this tab. It is not published, and does not make an unreviewed guide safe to follow.</p>
    <div className="feedback-choices">{([
      ["worked", "Worked"], ["partly", "Partly worked"], ["not_worked", "Did not work"],
    ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={outcome === value} onClick={() => { setOutcome(value); setSaved(false); }}>{label}</button>)}</div>
    <div className="field"><label htmlFor={`temporary-feedback-${slug}`}>Your feedback notes <span>(optional)</span></label>
      <textarea id={`temporary-feedback-${slug}`} maxLength={1000} value={comment} onChange={event => { setComment(event.target.value); setSaved(false); }}/></div>
    <button className="button button-small" disabled={!outcome}>Save outcome</button>
    {saved && <p className="status-message" role="status">Outcome saved in this tab. Updating it replaces your previous answer.</p>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
  </form>;
}
