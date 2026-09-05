"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { hasConvex } from "@/lib/config";
import GuideCard from "./guide-card";
import ExampleGuides from "./example-guides";

export default function HomePopular() {
  return <>{hasConvex && <PublishedPopular/>}<ExampleGuides limit={3}/></>;
}
function PublishedPopular() {
  const guides = useQuery(api.catalog.list,{});
  if(guides===undefined) return <div className="loading-skeleton" role="status" aria-label="Loading available fixes"/>;
  if(!guides.length) return <div className="empty-state"><h3>Good guidance takes a little care.</h3><p>Our repair library is awaiting reviewed content. No draft instructions are presented as ready-to-use fixes.</p><Link className="text-link" href="/catalog">View the catalog →</Link></div>;
  return <div className="guide-grid home-guides">{guides.slice(0,3).map(guide=><GuideCard key={guide.slug} guide={guide}/>)}</div>;
}
