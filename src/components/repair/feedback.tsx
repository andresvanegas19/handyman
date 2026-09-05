"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Outcome } from "@/lib/domain";
import { messageFromError } from "@/lib/media";

export default function Feedback({ problemId, guideVersionId, previous }: { problemId: Id<"problems">; guideVersionId: Id<"guideVersions">; previous?: {outcome: Outcome; comment: string} }) {
  const save = useMutation(api.feedback.save);
  const [outcome,setOutcome] = useState<Outcome | undefined>(previous?.outcome);
  const [comment,setComment] = useState(previous?.comment ?? "");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [saved,setSaved] = useState(false);
  return <form className="feedback-panel" onSubmit={async e => {
    e.preventDefault(); if (!outcome || busy) return; setBusy(true); setError(""); setSaved(false);
    try { await save({problemId,guideVersionId,outcome,comment}); setSaved(true); }
    catch(e) { setError(messageFromError(e)); } finally { setBusy(false); }
  }}><h2>How did it go?</h2><p className="small">Share an outcome only after trying this guide. You can update your answer without adding another response.</p><div className="feedback-choices">{([{value:"worked",label:"Worked",Icon:CheckCircle2},{value:"partly",label:"Partly worked",Icon:MinusCircle},{value:"not_worked",label:"Did not work",Icon:XCircle}] as const).map(({value,label,Icon}) => <button key={value} type="button" aria-pressed={outcome===value} disabled={busy} onClick={() => {setOutcome(value);setSaved(false);}}><Icon size={15} style={{verticalAlign:"middle",marginRight:6}}/>{label}</button>)}</div><div className="field"><label htmlFor={`feedback-${guideVersionId}`}>Anything you&apos;d like to add? <span>(optional, private)</span></label><textarea id={`feedback-${guideVersionId}`} rows={3} maxLength={1000} value={comment} onChange={e => {setComment(e.target.value);setSaved(false);}} disabled={busy} placeholder="What helped, or what didn't quite work?"/></div>{error && <div className="notice notice-error" role="alert">{error}</div>}<button className="button button-small" disabled={!outcome || busy}>{busy ? "Saving…" : previous ? "Update outcome" : "Save outcome"}</button>{saved && <p className="status-message" role="status">Your outcome is saved. Thank you for sharing what happened.</p>}</form>;
}
