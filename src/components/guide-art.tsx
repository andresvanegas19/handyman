import { Droplets, DoorOpen, PanelsTopLeft, Rows3, Grip, Wind } from "lucide-react";

export default function GuideArt({ slug, large = false }: { slug: string; large?: boolean }) {
  const kind = slug.includes("hinge") ? "hinge" : slug.includes("knob") ? "knob" : slug.includes("drawer") ? "drawer" : slug.includes("window") ? "window" : slug.includes("weather") ? "weather" : "aerator";
  const Icon = { hinge: DoorOpen, knob: Grip, drawer: Rows3, window: PanelsTopLeft, weather: Wind, aerator: Droplets }[kind];
  return <div className={`guide-art art-${kind} ${large ? "art-large" : ""}`} aria-hidden="true"><span className="art-circle"/><div className="art-object"><Icon size={large ? 100 : 74} strokeWidth={1.1}/></div><span className="art-spark">✦</span><span className="art-line"/></div>;
}
