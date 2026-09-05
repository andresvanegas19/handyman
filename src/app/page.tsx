import Link from "next/link";
import { ArrowRight, ArrowUpRight, Box, Camera, Layers3, Mic, MessageSquareText, ShieldCheck, Check, Search, Wrench } from "lucide-react";
import HomeIllustration from "@/components/home-illustration";
import HomePopular from "@/components/home-popular";
import { hasConvex, visualRepairEnabled } from "@/lib/config";
import PartsViewer from "@/components/viewer/PartsViewer";

export default function HomePage() {
  const steps = visualRepairEnabled ? [
    { icon: Camera, title: "Photo + description", text: "Share both a close-up photo and a written problem. Authorize provider processing once before submission." },
    { icon: Search, title: "Identify & check", text: "Automatically assess the visible product and safety, then check for a compatible saved solution and model." },
    { icon: MessageSquareText, title: "Research", text: "When needed, research supporting product sources and prepare a private, source-grounded AI draft." },
    { icon: Box, title: "Prepare mapped 3D", text: "Reuse a compatible reference or generate approximate geometry, then validate the parts needed for every step." },
    { icon: Layers3, title: "Open automatically", text: "Follow saved progress. Instructions appear only when the mapped 3D model is ready and has loaded successfully." },
    { icon: Wrench, title: "One step at a time", text: "Navigate steps to highlight and focus the relevant parts. Pause if the object or model does not match. AI drafts are not human-reviewed." },
  ] : [
    { icon: Camera, title: "Photo", text: "Show the visible problem. Add the product name and what changed; photos cannot reveal hidden mechanisms." },
    { icon: Search, title: "Diagnose", text: hasConvex
      ? "Receive a tentative assessment and applicability questions, not a confirmed diagnosis."
      : "Save observations and choose an example manually. AI assessment needs a connected backend." },
    { icon: Box, title: "Reconstruct", text: "Start with a labeled reference model. Exact photo reconstruction is not available; generated geometry needs human review." },
    { icon: Wrench, title: "Generate repair plan", text: "Match reviewed catalog steps to the problem rather than inventing repair instructions. Temporary examples remain drafts." },
    { icon: Layers3, title: "Visualize in 3D", text: "Separate the model into parts, rotate it, and isolate the part you want to understand." },
    { icon: MessageSquareText, title: "Guide user", text: "Connect each step to its visible part. Check recognition, direction, force limits, and when to stop." },
  ];
  return <>
    <section className="hero container"><div className="hero-copy"><div className="eyebrow hero-eyebrow"><span/>HOME REPAIRS, MADE SIMPLE</div><h1>A little help.<br/><span>A better home.</span></h1><p className="hero-description">That drip, squeak, or wobble? Let&apos;s figure it out.<br className="desktop-break"/> Get clear guidance for the small fixes that make<br className="desktop-break"/> a big difference.</p><Link href="/problems/new" className="button hero-button">Let&apos;s fix something <ArrowUpRight size={19}/></Link><div className="input-methods"><Link href="/problems/new?input=text"><MessageSquareText size={16}/>Describe it</Link><Link href="/problems/new?input=photo"><Camera size={16}/>Snap a photo</Link><Link href="/problems/new?input=audio"><Mic size={16}/>Talk it through</Link></div><div className="hero-reassurance"><ShieldCheck size={16}/>A little know-how. No guesswork.</div></div><HomeIllustration/></section>
    <div className="benefit-strip"><div className="container benefits"><span><Check size={17}/>Simple, step-by-step guidance</span><span><Check size={17}/>See how the parts fit together</span><span><Check size={17}/>Know when to call a pro</span></div></div>
    <section className="section container"><div className="section-heading"><div><span className="eyebrow">SMALL FIXES, BIG SATISFACTION</span><h2>A good place to start.</h2><p>Everyday home hiccups. A little less mystery.</p></div><Link className="text-link" href="/catalog">Explore all fixes <ArrowRight size={18}/></Link></div><HomePopular/></section>
    <section className="container section" aria-labelledby="door-demo-title">
      <div className="guide-layout">
        <div><span className="eyebrow">A 3D HANDYMAN, NOT JUST MORE INSTRUCTIONS</span><h2 id="door-demo-title">Take it apart.<br/>On screen.</h2>
          <p>“Find the hinge” only helps if you know which part that is. Explore a whole door, separate its visible components, and inspect each one without touching your own hardware.</p>
          <p>Choose <strong>Explode view</strong>, select a labeled part, then use <strong>Isolate part</strong> or <strong>Focus part</strong>. Each tutorial connects those parts to visual checkpoints.</p>
          <p className="small">This four-part door is a procedural illustration, not a Tripo output or a scan of your home. It does not reveal the latch internals or authorize disassembly.</p>
          <Link className="button button-secondary" href="/examples/worn-weatherstrip">Explore a visual tutorial <ArrowRight size={17}/></Link>
        </div>
        <PartsViewer kind="door"/>
      </div>
    </section>
    <section className="how-section" id="how-it-works"><div className="container"><div className="center-heading"><span className="eyebrow">YOU&apos;VE GOT THIS. WE&apos;VE GOT YOU.</span><h2>From “what&apos;s that?” to “got it.”</h2><p>A simpler way to understand what your home needs.</p><Link className="text-link" href="/catalog#examples">Explore the examples <ArrowRight size={18}/></Link></div><div className="steps-grid">{steps.map((step,i) => <div className="how-step" key={step.title}><div className="step-icon"><step.icon size={28}/><span>0{i+1}</span></div><h3>{step.title}</h3><p>{step.text}</p></div>)}</div></div></section>
    <section className="container section safety-section"><div className="safety-icon"><ShieldCheck size={37}/></div><div><span className="eyebrow">CONFIDENCE, NOT OVERCONFIDENCE</span><h2>Sometimes the best fix is a professional.</h2><p>We stick to small, low-risk repairs. Electrical, gas, structural issues, or major leaks? Stop and get qualified help. Your safety always comes first.</p></div><Link href="/privacy#safety" className="text-link">Our safety approach <ArrowRight size={18}/></Link></section>
    <section className="container bottom-cta"><div><span className="eyebrow">HOME FEELS BETTER WHEN THINGS WORK.</span><h2>What can we help you fix?</h2><p>You don&apos;t need to know the name of the part. Just start here.</p></div><Link href="/problems/new" className="button">Describe a problem <ArrowUpRight size={19}/></Link></section>
  </>;
}
