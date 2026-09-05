import Link from "next/link";
import { Plus } from "lucide-react";
import ProblemHistory from "@/components/problem-history";
export default function ProblemsPage() { return <div className="container page-section"><div className="section-heading"><div className="page-heading" style={{marginBottom:0}}><span className="eyebrow">ONE HOME. ALL YOUR LITTLE FIXES.</span><h1>My repairs</h1><p>Pick up where you left off. Your submissions and comments stay private.</p></div><Link href="/problems/new" className="button button-secondary"><Plus size={17}/>New repair</Link></div><ProblemHistory/></div>; }
