import type { AssemblyPart } from "./domain";

export type RepairPhase = "queued" | "recognizing" | "checking_cache" | "researching" | "planning" | "generating_model" | "segmenting" | "mapping" | "validating" | "ready" | "needs_input" | "referral" | "failed" | "cancelled";
export type ViewerFailureCode = "model_missing" | "manifest_invalid" | "download_failed" | "download_timeout" | "render_failed" | "render_timeout" | "session_expired";
export interface RepairSolution {
  title: string;
  summary: string;
  prerequisites: string[];
  stopConditions: string[];
  steps: { id: string; title: string; description: string; partIds: string[]; sourceIds: string[] }[];
  sources: { id: string; url: string; title: string }[];
}
export interface RepairSceneManifest {
  id: string;
  source: "generated" | "reference";
  parts: { id: string; label: string; description: string; nodeNames: string[]; explodeOffset: number[] }[];
}
export interface RepairRecommendations {
  summary: string;
  urgent: boolean;
  items: { title: string; description: string }[];
  questions: string[];
  sources: { url: string; title: string }[];
  identification?: { product: string; brand: string; model: string; confidence: number };
  visionModel?: string;
  imageDescription?: string;
  visibleFeatures?: string[];
}
export interface RepairPipelineState {
  phase: RepairPhase;
  message?: string;
  retryable: boolean;
  cacheHit: boolean;
  solution?: RepairSolution;
  scene?: RepairSceneManifest;
  preview?: { id: string };
  recommendations?: RepairRecommendations;
}

/** An owner-authorized private draft, deliberately not a ReviewedAssembly. */
export interface PrivateMappedScene {
  kind: "private-mapped";
  url: string;
  parts: AssemblyPart[];
}

export const phaseLabels: Record<RepairPhase, string> = {
  queued: "Your photo and problem are queued for review",
  recognizing: "Examining your photo and problem",
  checking_cache: "Checking for relevant saved guidance",
  researching: "Finding documentation and possible next steps",
  planning: "Assessing source-supported repair options",
  generating_model: "Preparing your private 3D model",
  segmenting: "Identifying separate visible components",
  mapping: "Matching repair steps to model parts",
  validating: "Checking the solution and every 3D target",
  ready: "Opening your 3D workspace",
  needs_input: "A few details would help narrow this down",
  referral: "Safer next steps for this problem",
  failed: "Review available guidance or retry",
  cancelled: "This repair was stopped",
};

export function isActivePhase(phase: RepairPhase) {
  return !["ready", "needs_input", "referral", "failed", "cancelled"].includes(phase);
}

export function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function validateRepairManifest(scene: RepairSceneManifest, solution: RepairSolution): AssemblyPart[] {
  const ids = new Set<string>();
  const nodes = new Set<string>();
  if (!scene.id || !scene.parts.length || !solution.steps.length || !solution.title.trim() || !solution.summary.trim()) throw new Error("The repair is missing its mapped model or instructions.");
  const parts = scene.parts.map(part => {
    if (!part.id || ids.has(part.id) || !part.label.trim() || !part.nodeNames.length || part.nodeNames.some(node => !node || nodes.has(node))) throw new Error("The model has invalid or overlapping part mappings.");
    ids.add(part.id);
    part.nodeNames.forEach(node => nodes.add(node));
    if (part.explodeOffset.length !== 3 || !part.explodeOffset.every(Number.isFinite)) throw new Error("The model has invalid part coordinates.");
    const explodeOffset: [number, number, number] = [part.explodeOffset[0], part.explodeOffset[1], part.explodeOffset[2]];
    return { ...part, explodeOffset };
  });
  const sources = new Set(solution.sources.filter(source => safeSourceUrl(source.url)).map(source => source.id));
  const steps = new Set<string>();
  for (const step of solution.steps) {
    if (!step.id || steps.has(step.id) || !step.title.trim() || !step.description.trim() || !step.partIds.length || step.partIds.some(id => !ids.has(id)) || !step.sourceIds.length || step.sourceIds.some(id => !sources.has(id))) {
      throw new Error("A repair step is missing a valid model target or supporting source. Instructions remain locked.");
    }
    steps.add(step.id);
  }
  return parts;
}
