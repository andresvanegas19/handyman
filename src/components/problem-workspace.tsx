"use client";
import Link from "next/link";
import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ArrowUpRight, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { messageFromError } from "@/lib/media";
import { stateLabels } from "./problem-history";
import AuthGate from "./auth-gate";
import Feedback from "./repair/feedback";
import PrivateAttachment from "./private-attachment";
import { isConnected } from "@/lib/config";
import { TemporaryWorkspace } from "./temporary-repairs";
import RepairScene from "./repair/repair-scene";
import VisualTutorial from "./repair/visual-tutorial";
import RepairPipeline from "./repair/repair-pipeline";
import { toReviewedAssembly } from "@/lib/adapters";
import VisualRepairWorkspace from "./repair/visual-repair-workspace";

export default function ProblemWorkspace({ id }: { id: string }) {
  if (!isConnected) return <TemporaryWorkspace id={id}/>;
  return <AuthGate><Workspace problemId={id as Id<"problems">}/></AuthGate>;
}

function Workspace({ problemId }: { problemId: Id<"problems"> }) {
  const data = useQuery(api.problems.get, { problemId });
  const remove = useMutation(api.problems.remove);
  const removeMedia = useMutation(api.uploads.remove);
  const [error,setError] = useState("");
  const [deleting,setDeleting] = useState(false);
  const [confirmDelete,setConfirmDelete] = useState(false);
  const router = useRouter();
  if (data === undefined) return <div role="status"><div className="loading-skeleton"/><p>Opening your private repair…</p></div>;
  if (data === null) return <div className="empty-state"><h1>This repair isn&apos;t available.</h1><p>It may have been deleted or saved in a different browser session. Your other private repairs are still available in My repairs.</p><Link href="/problems" className="button">Back to My repairs</Link></div>;
  const { problem, media, analysis, feedback } = data;
  if (problem.workflow === "visual") return <VisualRepairWorkspace problemId={problemId}/>;
  const processing = problem.state === "analyzing" || problem.state === "transcribing";
  return <><Link className="breadcrumbs" href="/problems"><ArrowLeft size={15}/>Back to My repairs</Link><div className="section-heading"><div className="page-heading" style={{marginBottom:0}}><span className="eyebrow">YOUR REPAIR WORKSPACE</span><h1>One small step forward.</h1><span className="status-badge">{stateLabels[problem.state]}</span></div><button className="button button-secondary button-small" onClick={() => setConfirmDelete(!confirmDelete)} disabled={deleting}><Trash2 size={15}/>Delete repair</button></div>
    {confirmDelete && <div className="notice"><div><strong>Delete this repair and its stored media?</strong><p>This removes the application record, analysis, and feedback. Provider retention follows provider policies. This cannot be undone.</p><div className="form-actions" style={{marginTop:13}}><button className="button button-danger button-small" disabled={deleting} onClick={async () => {setDeleting(true);setError("");try{await remove({problemId});router.replace("/problems");}catch(e){setError(messageFromError(e));setDeleting(false);}}}>{deleting?"Deleting…":"Delete permanently"}</button><button className="button button-secondary button-small" disabled={deleting} onClick={() => setConfirmDelete(false)}>Keep this repair</button></div></div></div>}
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {processing && <div className="notice notice-sage" role="status"><div><strong>{problem.state==="transcribing" ? "Turning your voice note into words…" : "Looking for an appropriate next step…"}</strong><p>You can leave this page and come back. Progress is saved, and results update here automatically. A suggestion is not a confirmed diagnosis.</p></div></div>}
    {problem.failure && <div className="notice notice-error" role="alert"><div><strong>We couldn&apos;t complete this step.</strong><p>{problem.failure}</p><p>Your input is saved. Review it below and retry when the service is available.</p></div></div>}
    <section className="workspace-section"><h2>What you shared</h2><p>{problem.text || "No written description — your attachment provides the starting point."}</p>{media.length > 0 && <div className="history-list">{media.map(item => <div key={item._id} className="history-card" style={{padding:13}}><PrivateAttachment media={item}/><button className="icon-button" disabled={processing || deleting} aria-label={`Remove ${item.kind}`} onClick={async () => {try{await removeMedia({mediaId:item._id});}catch(e){setError(messageFromError(e));}}}><Trash2 size={15}/></button></div>)}</div>}</section>
    {!processing && <InputRevision key={`input-${problem.revision}`} problem={problem} hasAudio={media.some(m=>m.kind==="audio")} hasPending={media.some(m=>m.state==="reserved")} onError={setError}/>}
    {analysis && <section className="workspace-section">
      <span className="eyebrow">A SUGGESTION, NOT A DIAGNOSIS</span>
      <h2>{analysis.result.outcome==="referral" ? "This one needs qualified help." : analysis.result.outcome==="follow_up" ? "A little more context would help." : "A possible place to start."}</h2>
      <p>{analysis.result.summary}</p>
      {analysis.result.outcome==="referral" && <div className="notice"><ShieldAlert size={22}/><p>Don&apos;t attempt disassembly or a hazardous repair. Contact a qualified professional. For immediate danger, leave the area if safe and contact local emergency services.</p></div>}
      {analysis.result.evidence.length>0 && <><h3>What this is based on</h3><ul className="check-list">{analysis.result.evidence.map(item=><li key={item}>{item}</li>)}</ul></>}
      {analysis.result.questions.length>0 && <><h3>Before taking another step</h3><ul className="check-list">{analysis.result.questions.map(item=><li key={item}>{item}</li>)}</ul><p className="small">Add your answers to the description above, then save and request a new analysis.</p></>}
      {analysis.result.guideVersionIds.map(guideVersionId => <MatchedGuide key={guideVersionId} problemId={problemId} guideVersionId={guideVersionId} selected={problem.selectedGuideVersionId===guideVersionId} previous={feedback.find(f=>f.guideVersionId===guideVersionId)} photos={media.filter(item => item.kind === "photo" && item.state === "ready")}/>)}
    </section>}
    <RepairScene key={`scene-${problem.revision}`} problemId={problemId} photos={media}/>
  </>;
}
export function InputRevision({problem,hasAudio,hasPending,onError}:{problem:Doc<"problems">;hasAudio:boolean;hasPending:boolean;onError:(message:string)=>void}) {
  const [text,setText] = useState(problem.text);
  const [transcript,setTranscript] = useState(problem.transcript);
  const [confirmed,setConfirmed] = useState(problem.transcriptConfirmed);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const update = useMutation(api.problems.update);
  const analyze = useMutation(api.problems.analyze);
  const transcribe = useMutation(api.problems.transcribe);
  const run = async (action:"analyze"|"transcribe"|"save") => {
    setBusy(true);setError("");onError("");
    try {
      await update({problemId:problem._id,text,transcript,transcriptConfirmed:confirmed});
      if(action==="analyze") await analyze({problemId:problem._id});
      if(action==="transcribe") await transcribe({problemId:problem._id});
    }catch(e){const message=messageFromError(e);setError(message);onError(message);}finally{setBusy(false);}
  };
  return <section className="workspace-section"><h2>{hasAudio && !problem.transcriptConfirmed ? "Your words, with the final say." : "Add or update the details"}</h2>{hasAudio && <p className="small">Read the transcript carefully, correct anything that doesn&apos;t sound right, and confirm it before asking for analysis.</p>}<div className="field"><label htmlFor="saved-description">Description & follow-up answers</label><textarea id="saved-description" maxLength={4000} value={text} onChange={e=>setText(e.target.value)} disabled={busy}/></div>{hasAudio && <><div className="field"><label htmlFor="transcript">Editable transcript</label><textarea id="transcript" placeholder="Transcribe your voice note first, or type what you said here." maxLength={8000} rows={5} value={transcript} onChange={e=>{setTranscript(e.target.value);setConfirmed(false);}} disabled={busy}/></div><label className="consent-label"><input type="checkbox" checked={confirmed} disabled={busy || !transcript.trim()} onChange={e=>setConfirmed(e.target.checked)}/><span>I&apos;ve reviewed this transcript and confirm that it accurately describes my problem.</span></label></>}{error && <div role="alert" className="notice notice-error">{error}</div>}{hasPending && <p className="small">Remove incomplete attachments above before requesting analysis.</p>}<div className="form-actions"><button className="button" disabled={busy || hasPending || (hasAudio && !confirmed)} onClick={()=>void run("analyze")}>{busy?"Saving…":"Save & request analysis"}<ArrowUpRight size={16}/></button><button className="button button-secondary" disabled={busy} onClick={()=>void run("save")}>Save only</button>{hasAudio && <button className="text-link" style={{border:0,background:"none"}} disabled={busy || hasPending} onClick={()=>void run("transcribe")}>Retry transcription</button>}</div></section>;
}
function MatchedGuide({problemId,guideVersionId,previous,selected,photos}:{problemId:Id<"problems">;guideVersionId:Id<"guideVersions">;previous?:Doc<"feedback">;selected:boolean;photos:ComponentProps<typeof PrivateAttachment>["media"][]}) {
  const data = useQuery(api.catalog.version,{guideVersionId});
  const current = useQuery(api.catalog.list,{});
  const select = useMutation(api.problems.selectGuide);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  if(data===undefined || current===undefined) return <p role="status">Loading suggested guide…</p>;
  if(!data) return <div className="notice"><p>This guide revision has been withdrawn or is unavailable. Do not substitute a different revision; request fresh analysis. {previous && `Your saved outcome was: ${previous.outcome === "worked" ? "Worked" : previous.outcome === "partly" ? "Partly worked" : "Did not work"}.`}</p></div>;
  const {guide}=data;
  const assembly = toReviewedAssembly(data.assembly);
  const isCurrent=current.some(g=>g._id===guideVersionId);
  return <div style={{marginTop:24}}>
    <h3>{guide.title}</h3><p className="small">{guide.summary}</p>
    <RepairPipeline hasPhoto={photos.length > 0} assessed hasPlan={selected} hasModel={!!assembly} guiding={selected}/>
    <div className="form-actions">
      <Link href={`/catalog/${guide.slug}?versionId=${guideVersionId}`} className="button button-secondary">Open guide · version {guide.version}<ArrowUpRight size={16}/></Link>
      {selected ? <span className="status-badge">Selected for this repair</span> : isCurrent ? <button className="button button-small" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await select({problemId,guideVersionId});}catch(e){setError(messageFromError(e));}finally{setBusy(false);}}}>{busy?"Saving selection…":"Use this guide"}</button> : <span className="small muted">Historical revision</span>}
    </div>
    {error&&<p className="notice notice-error" role="alert">{error}</p>}
    {selected && <VisualTutorial guide={guide} assembly={assembly} evidence={photos.length ? photos.map(photo => <PrivateAttachment key={photo._id} media={photo}/>) : undefined}/>}
    <Feedback key={guideVersionId} problemId={problemId} guideVersionId={guideVersionId} previous={previous}/>
  </div>;
}
