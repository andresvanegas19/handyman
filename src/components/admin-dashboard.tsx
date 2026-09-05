"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useAction, useMutation, useQuery } from "convex/react";
import { FileCheck2, LockKeyhole, Sparkles, Upload } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { STARTER_GUIDES } from "@/lib/catalog";
import { editableGuide, editableParts } from "@/lib/editor-validation";
import { messageFromError } from "@/lib/media";
import AuthGate from "./auth-gate";

const PartsViewer = dynamic(()=>import("./viewer/PartsViewer"),{ssr:false});

export default function AdminDashboard() { return <AuthGate label="A considered review comes first."><AdminAuthority/></AuthGate>; }
function AdminAuthority() {
  const allowed = useQuery(api.admin.isAdmin,{});
  if(allowed===undefined) return <div className="empty-state" role="status">Checking administrator authorization…</div>;
  if(!allowed) return <div className="empty-state"><LockKeyhole size={35}/><h2>This workspace is for reviewers.</h2><p>This browser session does not have editorial access. Access is granted by server-side configuration, not by this page.</p></div>;
  return <><ScheduledFailures/><Dashboard/></>;
}
export function ScheduledFailures() {
  const failures=useQuery(api.admin.scheduledFailures,{});
  if(failures===undefined)return <p className="small" role="status">Checking scheduled operations…</p>;
  if(!failures.length)return <p className="small muted">No failed scheduled operations reported.</p>;
  return <section className="workspace-section" aria-labelledby="scheduled-failures">
    <h2 id="scheduled-failures">Scheduled operations need attention</h2>
    <p className="small">Review these backend failures, including cleanup tasks. Do not assume the affected operation completed.</p>
    {failures.map(failure=><div className="notice notice-error" role="alert" key={failure._id}>
      <div><strong>{failure.functionName}</strong><p>{failure.message}</p><p className="small">{new Date(failure.scheduledTime).toLocaleString()}</p></div>
    </div>)}
  </section>;
}
function Dashboard() {
  const guides = useQuery(api.admin.list,{});
  const assets = useQuery(api.admin.assets,{});
  const jobs = useQuery(api.admin.jobs,{});
  const seed = useMutation(api.seed.run);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  if(guides===undefined || assets===undefined || jobs===undefined) return <div className="loading-skeleton" role="status" aria-label="Loading review workspace"/>;
  return <><div className="notice notice-sage"><FileCheck2 size={23}/><p><strong>Publication is a human decision.</strong>Review safe applicability, instructions, geometry, part mappings, provenance, and rights. Generated assets and starter guides are drafts, never automatic approvals.</p></div><div className="form-actions" style={{marginBottom:25}}><button className="button button-secondary button-small" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{const result=await seed({});setMessage(`${result.inserted} starter drafts added. Existing content was not changed.`);}catch(e){setError(messageFromError(e));}finally{setBusy(false);}}}>Add missing starter drafts</button><span className="small muted">{guides.length} guide versions · {assets.length} assemblies</span></div>{message && <p role="status" className="status-message">{message}</p>}{error && <div className="notice notice-error" role="alert">{error}</div>}<div className="admin-grid"><GuideEditor guides={guides} assets={assets}/><GenerationForm/></div><section className="workspace-section"><h2>Generation jobs</h2>{jobs.length===0?<p>No generation jobs have been requested. No models are fabricated or substituted.</p>:<div className="history-list">{jobs.map(job=><div className="history-card" key={job._id}><div><span className="status-badge">{job.state}</span><p>{new Date(job._creationTime).toLocaleString()} · {job.attempts} attempts</p>{job.providerTaskId&&<p>Provider task: {job.providerTaskId}</p>}{job.failure&&<p role="alert">{job.failure}</p>}</div></div>)}</div>}</section><section className="workspace-section"><h2>Assets & part review</h2>{assets.length===0?<p>Request a catalog asset first. Real Tripo output must be inspected and, when necessary, cleaned in Blender.</p>:assets.map(asset=><AssetReview key={`${asset._id}-${asset.storageId}-${asset.status}`} asset={asset}/>)}</section></>;
}
type Asset = Doc<"assemblies"> & {url:string|null};
function GuideEditor({guides,assets}:{guides:Doc<"guideVersions">[];assets:Asset[]}) {
  const [selected,setSelected] = useState<Id<"guideVersions">|undefined>(guides[0]?._id);
  const [json,setJson] = useState(JSON.stringify(guides[0]?.guide??STARTER_GUIDES[0],null,2));
  const [assemblyId,setAssemblyId] = useState<Id<"assemblies">|undefined>();
  const [reviewed,setReviewed] = useState(false);
  const [rights,setRights] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const save = useMutation(api.admin.saveDraft);
  const publish = useMutation(api.admin.publish);
  const unpublish = useMutation(api.admin.unpublish);
  const selectedGuide = guides.find(g=>g._id===selected);
  const unsaved = (()=>{try{return JSON.stringify(editableGuide.parse(JSON.parse(json)))!==JSON.stringify(editableGuide.parse(selectedGuide?.guide));}catch{return true;}})();
  const act = async(operation:()=>Promise<unknown>,success:string)=>{
    setBusy(true);setMessage("");setError("");try{await operation();setMessage(success);}catch(e){setError(messageFromError(e));}finally{setBusy(false);}
  };
  return <section className="form-panel">
    <h2>Guide drafts & publication</h2>
    <p className="small">Edit all instructions and step-to-part mappings as JSON. Optional step visual cues use location, lookFor, motion, force, risk, and check (1–800 characters each) inside a visual object. Review these against the exact product; never derive force or direction from explode offsets. Published versions are immutable; increase the version and set status to draft to create a revision.</p>
    <div className="field"><label htmlFor="admin-guide">Guide version</label><select id="admin-guide" value={selected??""} onChange={e=>{const row=guides.find(g=>g._id===e.target.value);setSelected(row?._id);setJson(JSON.stringify(row?.guide??STARTER_GUIDES[0],null,2));setReviewed(false);setRights(false);setAssemblyId(undefined);setMessage("");setError("");}}><option value="">New draft</option>{guides.map(g=><option key={g._id} value={g._id}>{g.guide.title} · v{g.guide.version} · {g.guide.status}</option>)}</select></div>
    <div className="field"><label htmlFor="guide-json">Guide content & step mappings</label><textarea id="guide-json" value={json} onChange={e=>{setJson(e.target.value);setReviewed(false);setRights(false);}} spellCheck={false} disabled={busy}/></div>
    <button className="button button-secondary button-small" disabled={busy} onClick={()=>void act(async()=>{const result=editableGuide.parse(JSON.parse(json));const id=await save({guide:result});setSelected(id);},"Draft saved. Preview and review it before publication.")}>Save draft</button>
    <div className="field" style={{marginTop:24}}><label htmlFor="assembly-link">Reviewed assembly (when applicable)</label><select id="assembly-link" value={assemblyId??""} onChange={e=>{setAssemblyId(assets.find(a=>a._id===e.target.value)?._id);setRights(false);}}><option value="">No assembly</option>{assets.filter(a=>a.status==="reviewed").map(a=><option key={a._id} value={a._id}>{a.prompt.slice(0,80)}</option>)}</select></div>
    <label className="consent-label"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>I am qualified to confirm the saved guide&apos;s safety, applicability, complete instructions, and stop conditions.</span></label>
    <label className="consent-label"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/><span>I have verified usage rights and any linked assembly&apos;s part mappings.</span></label>
    <div className="form-actions"><button className="button button-small" disabled={busy||!selected||!reviewed||!rights||selectedGuide?.guide.status!=="draft"||unsaved} onClick={()=>selected&&void act(()=>publish({guideVersionId:selected,safetyReviewed:reviewed,rightsReviewed:rights,assemblyId}),"Saved guide published. The public catalog has updated.")}>Approve & publish saved draft</button>{selectedGuide?.guide.status==="published"&&<button className="button button-secondary button-small" disabled={busy} onClick={()=>selected&&void act(()=>unpublish({guideVersionId:selected}),"Guide removed from public browsing. Historical versions are retained.")}>Unpublish</button>}</div>
    <p className="field-hint">Save changes first. Approval applies only to the saved draft, not unsaved JSON.</p>
    {error&&<div className="notice notice-error" role="alert">{error}</div>}{message&&<p role="status" className="status-message">{message}</p>}
  </section>;
}
function GenerationForm(){
  const request = useMutation(api.tripo.request);
  const [prompt,setPrompt] = useState("");
  const [source,setSource] = useState("");
  const [license,setLicense] = useState("");
  const [authorized,setAuthorized] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  return <form className="form-panel" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");setMessage("");try{await request({prompt,source,license});setMessage("Generation queued. Follow the persisted job status below. The output will remain a draft.");setAuthorized(false);}catch(e){setError(messageFromError(e));}finally{setBusy(false);}}}><Sparkles size={25}/><h2 style={{marginTop:15}}>Request a catalog model</h2><p className="small">Tripo generation is a paid, asynchronous operation. Do not use private user photos. Confirm the configured budget before requesting a task.</p><div className="field"><label htmlFor="generation-prompt">Approved model prompt</label><textarea id="generation-prompt" required minLength={20} maxLength={1500} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Describe the approved illustrative assembly and visible components…" disabled={busy}/></div><div className="field"><label htmlFor="generation-source">Source & provenance</label><textarea id="generation-source" required minLength={10} maxLength={1000} value={source} onChange={e=>setSource(e.target.value)} placeholder="Record the reference source and who approved it." disabled={busy}/></div><div className="field"><label htmlFor="generation-license">Usage rights</label><input type="text" id="generation-license" required minLength={5} maxLength={500} value={license} onChange={e=>setLicense(e.target.value)} disabled={busy}/></div><label className="consent-label"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)} disabled={busy}/><span>I am authorized to incur this generation cost and have checked for an existing task. This asset will require human review.</span></label><button className="button" disabled={busy||!authorized}>{busy?"Requesting…":"Request Tripo generation"}<Sparkles size={16}/></button>{error&&<div className="notice notice-error" role="alert" style={{marginTop:15}}>{error}</div>}{message&&<p role="status" className="status-message">{message}</p>}</form>;
}
function AssetReview({asset}:{asset:Asset}){
  const [parts,setParts] = useState(JSON.stringify(asset.parts,null,2));
  const [confirmed,setConfirmed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const reserve = useMutation(api.tripo.reserveCleanedUpload);
  const finalize = useAction(api.tripo.finalizeCleanedUpload);
  const review = useMutation(api.admin.reviewAssembly);
  const parsed = editableParts.safeParse((()=>{try{return JSON.parse(parts);}catch{return null;}})());
  const preview = asset.url && parsed.success && parsed.data.length > 0
    ? <PartsViewer assembly={{url:asset.url,parts:parsed.data,reviewed:asset.status==="reviewed"}} reviewMode={asset.status==="draft"}/>
    : null;
  const upload = async(file?:File)=>{
    if(!file)return;setError("");setMessage("");
    if(!file.name.toLowerCase().endsWith(".glb")||!file.size||file.size>10*1024*1024){setError("Choose a self-contained GLB no larger than 10 MB.");return;}
    setBusy(true);try{const reservation=await reserve({assemblyId:asset._id});const response=await fetch(reservation.uploadUrl,{method:"POST",headers:{"Content-Type":"model/gltf-binary"},body:file});if(!response.ok)throw new Error("GLB upload failed. Try again.");const result:{storageId?:Id<"_storage">}=await response.json();if(!result.storageId)throw new Error("Upload returned no file reference.");await finalize({reservationId:reservation.reservationId,storageId:result.storageId});setMessage("Cleaned GLB stored and validated. Re-check part mappings before approval.");}catch(e){setError(messageFromError(e));}finally{setBusy(false);}
  };
  return <details style={{borderTop:"1px solid var(--line)",padding:"20px 0"}}><summary style={{cursor:"pointer",fontWeight:600}}>{asset.prompt.slice(0,90)} <span className="status-badge">{asset.status}</span></summary><p className="small" style={{marginTop:15}}>Source: {asset.source}<br/>Rights: {asset.license}<br/>{asset.triangleCount.toLocaleString()} triangles · {asset.nodeNames.length} mesh nodes · {asset.generatedByTripo?"Tripo-origin asset":"No validated generation yet"}</p>{asset.url&&<a className="text-link" href={asset.url} target="_blank" rel="noreferrer">Download current GLB for inspection ↗</a>}<p className="small">Mesh nodes: {asset.nodeNames.join(", ")||"Awaiting asset"}</p>{asset.status==="draft"&&<><label className="upload-zone"><Upload size={20}/><span>Upload Blender-cleaned GLB<small>10 MB max · named separate mesh nodes · no external resources</small></span><input type="file" accept=".glb" className="file-input" disabled={busy||!asset.generatedByTripo} onChange={e=>{void upload(e.target.files?.[0]);e.target.value="";}}/></label><div className="field" style={{marginTop:20}}><label htmlFor={`parts-${asset._id}`}>Reviewed part definitions & explode offsets (JSON)</label><textarea id={`parts-${asset._id}`} rows={10} value={parts} onChange={e=>{setParts(e.target.value);setConfirmed(false);}} spellCheck={false}/><p className="field-hint">Each part needs id, label, description, nodeNames, and explodeOffset: [x, y, z]. All mesh nodes must be mapped once.</p></div>{!parsed.success&&<p className="small" role="status">Enter valid part JSON to preview or approve the mapping.</p>}</>}{preview}{asset.status==="draft"&&<><label className="consent-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I have personally reviewed the geometry, all part labels, safe applicability, usage rights, and mobile presentation. I confirm all four review requirements.</span></label><button className="button button-small" disabled={busy||!confirmed||!parsed.success||!asset.storageId||!asset.generatedByTripo} onClick={async()=>{if(!parsed.success)return;setBusy(true);setError("");try{await review({assemblyId:asset._id,parts:parsed.data,geometryReviewed:confirmed,applicabilityReviewed:confirmed,rightsReviewed:confirmed,mobileReviewed:confirmed});setMessage("Assembly approved. It is now available for guide publication.");}catch(e){setError(messageFromError(e));}finally{setBusy(false);}}}>Approve reviewed assembly</button></>}{error&&<div className="notice notice-error" role="alert">{error}</div>}{message&&<p role="status" className="status-message">{message}</p>}</details>;
}
