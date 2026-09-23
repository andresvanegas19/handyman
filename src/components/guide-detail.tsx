"use client";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import type { Guide, ReviewedAssembly } from "@/lib/domain";
import { GUIDE_PHOTOS, STARTER_GUIDES } from "@/lib/catalog";
import photoStyles from "./guide-photo.module.css";
import VisualTutorial from "./repair/visual-tutorial";
import { PreviewNotice } from "./service-notice";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { hasConvex } from "@/lib/config";
import { toReviewedAssembly } from "@/lib/adapters";
import type { Id } from "../../convex/_generated/dataModel";
import { TemporaryGuideFeedback } from "./temporary-repairs";

export function GuideContent({ guide, assembly }: { guide: Guide; assembly?: ReviewedAssembly }) {
  const photo = guide.status === "draft" ? GUIDE_PHOTOS[guide.slug] : undefined;
  return <>
    <Link className="breadcrumbs" href="/catalog"><ArrowLeft size={15}/>Back to all fixes</Link>
    <PreviewNotice/>
    <div className="guide-title"><span className="eyebrow">{guide.category}</span><h1>{guide.title}</h1></div>
    <VisualTutorial fullWidth guide={guide} assembly={assembly} evidence={photo && <figure className={photoStyles.reference}>
      <Image src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} sizes="(max-width: 800px) 100vw, 550px"/>
      <figcaption>{photo.caption}</figcaption>
      <a href={photo.src} target="_blank" rel="noreferrer">Open full-size reference photo</a>
    </figure>}>
    <div className="guide-title"><p>{guide.summary}</p>
      <div className="guide-tags"><span><Clock3 size={16}/>{guide.duration}</span><span><CheckCircle2 size={16}/>{guide.difficulty}</span><span>Version {guide.version} · {guide.status === "published" ? "Published" : "Draft preview"}</span></div>
    </div>
    <details><summary>Applicability, tools, and stop conditions</summary><div className="guide-layout">
      <div className="guide-instructions">
        <h2>Is this the right starting point?</h2><ul className="check-list">{guide.symptoms.map(s => <li key={s}>{s}</li>)}</ul>
        <h2>Before you begin</h2><ul className="check-list">{guide.prerequisites.map(s => <li key={s}>{s}</li>)}</ul>
        <h2>What you&apos;ll need</h2><div className="tool-list">{guide.tools.map(t => <span key={t}>{t}</span>)}</div>
      </div>
      <div className="notice"><ShieldAlert size={20}/><div><strong>Stop and get qualified help if…</strong><ul className="check-list">{guide.stopConditions.map(s => <li key={s}>{s}</li>)}</ul></div></div>
    </div></details>
    </VisualTutorial>
    {hasConvex ? <section className="feedback-panel"><h2>A small fix worth remembering.</h2><p className="small">Outcome feedback belongs to a saved repair and the guide version you tried. No ratings or success claims are simulated.</p><Link href="/problems" className="text-link">Open My repairs to share an outcome <ArrowLeft style={{transform:"rotate(180deg)"}} size={16}/></Link></section>
      : <TemporaryGuideFeedback slug={guide.slug} version={guide.version}/>}
  </>;
}
export default function GuideDetail({ slug, versionId }: { slug: string; versionId?: string }) {
  return hasConvex ? <PublishedGuide slug={slug} versionId={versionId}/> : <PreviewGuide slug={slug}/>;
}
export function PreviewGuide({ slug }: { slug: string }) {
  const guide = STARTER_GUIDES.find(g => g.slug === slug);
  return guide ? <GuideContent key={guide.slug} guide={guide}/> : <div className="empty-state"><h1>We couldn&apos;t find that guide.</h1><p>It may not be published or this link may be out of date.</p><Link href="/catalog" className="button">Explore available fixes</Link></div>;
}
function PublishedGuide({ slug, versionId }: { slug: string; versionId?: string }) {
  const current = useQuery(api.catalog.detail, versionId ? "skip" : { slug });
  const historical = useQuery(api.catalog.version, versionId ? { guideVersionId: versionId as Id<"guideVersions"> } : "skip");
  const data = versionId ? historical : current;
  if (data === undefined) return <div className="loading-skeleton" role="status" aria-label="Loading guide"/>;
  if (!data) return <div className="empty-state"><h1>This guide isn&apos;t available.</h1><p>Only reviewed, published guides are available here.</p><Link href="/catalog" className="button">Explore available fixes</Link></div>;
  if (data.guide.slug !== slug) return <div className="empty-state"><h1>This guide link doesn&apos;t match.</h1><p>Return to your repair to open its exact suggested guide revision.</p><Link href="/problems" className="button">Back to My repairs</Link></div>;
  return <>{versionId && <div className="notice notice-sage"><p>Viewing the exact published guide revision linked to your repair: version {data.guide.version}. Always review applicability and stop conditions before proceeding.</p></div>}<GuideContent guide={data.guide} assembly={toReviewedAssembly(data.assembly)}/><p className="small muted" style={{marginTop:20}}>Reported outcomes for this version: {data.counts.worked} worked · {data.counts.partly} partly worked · {data.counts.not_worked} did not work · {data.counts.total} total responses. Outcomes do not establish safety or suitability.</p></>;
}
