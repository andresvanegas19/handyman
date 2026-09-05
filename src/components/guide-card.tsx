import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import type { Guide } from "@/lib/domain";
import GuideArt from "./guide-art";

export default function GuideCard({ guide }: { guide: Guide }) {
  return <Link className="guide-card" href={`/catalog/${guide.slug}`}><div className="card-visual"><GuideArt slug={guide.slug}/>{guide.assemblyKind && <span className="model-badge">Interactive parts</span>}</div><div className="card-content"><span className="eyebrow card-category">{guide.category}</span><h3>{guide.title}<ArrowUpRight size={21}/></h3><p>{guide.summary}</p><div className="card-meta"><span><Clock3 size={14}/>{guide.duration}</span><span><span className="difficulty-dot"/>{guide.difficulty}</span></div></div></Link>;
}
