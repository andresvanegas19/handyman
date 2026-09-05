import type { Metadata } from "next";
import CatalogBrowser from "@/components/catalog-browser";
export const metadata: Metadata = { title: "Explore fixes" };
export default function CatalogPage() { return <div className="container page-section"><div className="page-heading"><span className="eyebrow">YOUR SMALL-FIX LIBRARY</span><h1>Explore fixes.</h1><p>A little know-how. A lot less “now what?” Find a familiar problem, understand the parts, and take a closer look at what comes next.</p></div><CatalogBrowser/></div>; }
