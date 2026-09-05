import Link from "next/link";
import { SearchX } from "lucide-react";
export default function NotFound() { return <div className="container empty-state page-section"><SearchX size={44}/><h1>This page needs a little fixing.</h1><p>We couldn&apos;t find what you&apos;re looking for. Let&apos;s get you back home.</p><Link href="/" className="button">Back to home</Link></div>; }
