"use client";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { STARTER_GUIDES } from "@/lib/catalog";
import type { Guide } from "@/lib/domain";
import GuideCard from "./guide-card";
import { PreviewNotice } from "./service-notice";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { hasConvex } from "@/lib/config";
import ExampleGuides from "./example-guides";

export function CatalogGrid({ guides }: { guides: Guide[] }) {
  const [search, setSearch] = useState("");
  const filtered = guides.filter(g => `${g.title} ${g.summary} ${g.symptoms.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <><PreviewNotice/><div className="search-box"><Search size={18}/><input type="search" aria-label="Search repairs" value={search} onChange={e => setSearch(e.target.value)} placeholder="A squeaky door? A stubborn drawer?"/>{search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={17}/></button>}</div>{filtered.length > 0 && <div className="guide-grid">{filtered.map(guide => <GuideCard key={guide.slug} guide={guide}/>)}</div>}</>;
}

function PublishedCatalog() {
  const guides = useQuery(api.catalog.list, {});
  if (guides === undefined) return <div role="status"><div className="loading-skeleton"/><p>Loading the published catalog…</p></div>;
  return <CatalogGrid guides={guides}/>;
}
export default function CatalogBrowser() { return hasConvex ? <><PublishedCatalog/><div className="section"><ExampleGuides/></div></> : <div id="examples"><CatalogGrid guides={STARTER_GUIDES}/></div>; }
