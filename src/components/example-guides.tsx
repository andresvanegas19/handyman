import Link from "next/link";
import { Sparkles } from "lucide-react";
import { STARTER_GUIDES } from "@/lib/catalog";
import GuideCard from "./guide-card";

export default function ExampleGuides({ limit }: { limit?: number }) {
  const guides = limit === undefined ? STARTER_GUIDES : STARTER_GUIDES.slice(0, limit);
  return <section id="examples" aria-labelledby="examples-title">
    <h3 id="examples-title">Explore draft examples</h3>
    <p className="preview-note"><Sparkles size={15}/>Preview — draft content. These examples are for exploration, not approved repair instructions.</p>
    <div className={`guide-grid${limit ? " home-guides" : ""}`}>{guides.map(guide => <GuideCard key={guide.slug} guide={guide} href={`/examples/${guide.slug}`}/>)}</div>
    {limit !== undefined && limit < STARTER_GUIDES.length && <Link className="text-link" href="/catalog#examples">Explore all examples →</Link>}
  </section>;
}
