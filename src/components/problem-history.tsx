"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowUpRight, ClipboardList } from "lucide-react";
import { api } from "../../convex/_generated/api";
import AuthGate from "./auth-gate";
import type { Id } from "../../convex/_generated/dataModel";
import { isConnected } from "@/lib/config";
import { TemporaryHistory } from "./temporary-repairs";
import { phaseLabels } from "@/lib/visual-repair";

export const stateLabels: Record<string, string> = { draft:"Draft", transcribing:"Transcribing", awaiting_transcript:"Review transcript", analyzing:"Finding your next step", suggestions:"Suggestions ready", follow_up:"A little more context needed", referral:"Professional help recommended", failed:"Needs attention" };
export default function ProblemHistory() { return isConnected ? <AuthGate><History/></AuthGate> : <TemporaryHistory/>; }
function History() {
  const problems = useQuery(api.problems.list, {});
  if (problems === undefined) return <div className="loading-skeleton" role="status" aria-label="Loading your repairs"/>;
  if (!problems.length) return <div className="empty-state"><ClipboardList size={40}/><h2>A fresh start for your small fixes.</h2><p>Your saved repairs will appear here. Start with a description, a photo, or a voice note.</p><Link href="/problems/new" className="button">Describe a problem <ArrowUpRight size={17}/></Link></div>;
  return <div className="history-list">{problems.map(problem => <article className="history-card" key={problem._id}><div><span className="eyebrow">{new Date(problem._creationTime).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span><h2><Link href={`/problems/${problem._id}`}>{(problem.text || problem.transcript || "A photo or voice-note repair").slice(0,110)}</Link></h2><span className="status-badge">{problem.workflow === "visual" ? problem.visualPhase === "ready" ? "3D prepared · open to view" : problem.visualPhase ? phaseLabels[problem.visualPhase] : "Visual repair · preparation not started" : stateLabels[problem.state] ?? problem.state}</span>{problem.selectedGuideVersionId&&<SelectedGuideSummary guideVersionId={problem.selectedGuideVersionId}/>}</div><Link className="button button-secondary" href={`/problems/${problem._id}`}>Open <ArrowUpRight size={15}/></Link></article>)}</div>;
}
function SelectedGuideSummary({guideVersionId}:{guideVersionId:Id<"guideVersions">}){
  const data=useQuery(api.catalog.version,{guideVersionId});
  if(data===undefined)return <p className="small" style={{marginTop:8}}>Loading selected guide…</p>;
  return <p className="small" style={{marginTop:8}}>{data?<Link href={`/catalog/${data.guide.slug}?versionId=${guideVersionId}`}>Selected: {data.guide.title} · v{data.guide.version}</Link>:"Previously selected guide is no longer available."}</p>;
}
