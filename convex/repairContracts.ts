import { v, type Infer } from "convex/values";

export const recognitionValidator = v.object({
  outcome: v.union(v.literal("identified"), v.literal("needs_input"), v.literal("referral")),
  summary: v.string(), product: v.string(), brand: v.string(), model: v.string(), variant: v.string(),
  symptom: v.string(), features: v.array(v.string()), prerequisites: v.array(v.string()), confidence: v.number(),
  imageDescription: v.optional(v.string()),
});
export const researchValidator = v.object({
  sources: v.array(v.object({ id: v.string(), url: v.string(), title: v.string(), excerpt: v.string() })),
  images: v.array(v.object({ url: v.string(), pageUrl: v.string(), title: v.string() })),
});
export const planValidator = v.object({
  title: v.string(), summary: v.string(), prerequisites: v.array(v.string()), stopConditions: v.array(v.string()),
  parts: v.array(v.object({ id: v.string(), label: v.string(), description: v.string() })),
  steps: v.array(v.object({
    id: v.string(), title: v.string(), description: v.string(), partIds: v.array(v.string()), sourceIds: v.array(v.string()),
  })),
});
export const mappedPartValidator = v.object({
  id: v.string(), label: v.string(), description: v.string(), nodeNames: v.array(v.string()), explodeOffset: v.array(v.number()),
});
export const mappingValidator = v.object({ parts: v.array(mappedPartValidator) });
export const phaseValidator = v.union(
  v.literal("queued"), v.literal("recognizing"), v.literal("checking_cache"), v.literal("researching"),
  v.literal("planning"), v.literal("generating_model"), v.literal("segmenting"), v.literal("mapping"),
  v.literal("validating"), v.literal("ready"), v.literal("needs_input"), v.literal("referral"),
  v.literal("failed"), v.literal("cancelled"),
);
export type Recognition = Infer<typeof recognitionValidator>;
export type Research = Infer<typeof researchValidator>;
export type RepairPlan = Infer<typeof planValidator>;
export type Mapping = Infer<typeof mappingValidator>;
export type RepairPhase = Infer<typeof phaseValidator>;
export const POLICY_VERSION = "visual-low-risk-v1";
export const ACTIVE_PHASES: RepairPhase[] = ["queued", "recognizing", "checking_cache", "researching", "planning", "generating_model", "segmenting", "mapping", "validating"];

const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function textFingerprint(text: string) {
  let hash = 2166136261;
  for (const char of text.trim().toLowerCase()) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  // This bounded lookup bucket is always followed by exact text and image-hash comparison.
  return `${text.trim().length}-${hash >>> 0}`;
}
export function compatibilityKey(r: Recognition) {
  return [r.product, r.brand, r.model, r.variant, r.symptom].map(normalize).join("|");
}
export function compatible(a: Recognition, b: Recognition) {
  const known = (s: string) => !!normalize(s) && !["unknown", "unspecified", "not visible", "n a"].includes(normalize(s));
  return a.outcome === "identified" && b.outcome === "identified" && a.confidence >= 0.85 && b.confidence >= 0.85 &&
    [a.product, a.brand, a.model, a.variant, b.product, b.brand, b.model, b.variant].every(known) &&
    compatibilityKey(a) === compatibilityKey(b) &&
    JSON.stringify(a.features.map(normalize).sort()) === JSON.stringify(b.features.map(normalize).sort()) &&
    JSON.stringify(a.prerequisites.map(normalize).sort()) === JSON.stringify(b.prerequisites.map(normalize).sort());
}
export function validatePlan(plan: RepairPlan, research: Research) {
  const parts = new Set(plan.parts.map(p => p.id));
  const sources = new Set(research.sources.map(s => s.id));
  if (!sources.size || sources.size !== research.sources.length || research.sources.some(source => {
    try {
      const url = new URL(source.url);
      return !source.id.trim() || !source.title.trim() || !source.excerpt.trim() ||
        url.protocol !== "https:" || Boolean(url.username || url.password);
    } catch { return true; }
  })) throw new Error("Supporting sources require distinct IDs and valid HTTPS provenance.");
  if (!plan.title.trim() || !plan.summary.trim() || !plan.stopConditions.length || !plan.prerequisites.length ||
      !plan.steps.length || plan.steps.length > 20 || !parts.size || parts.size !== plan.parts.length ||
      new Set(plan.steps.map(s => s.id)).size !== plan.steps.length ||
      plan.steps.some(s => !s.title.trim() || !s.description.trim() || !s.partIds.length ||
        s.partIds.some(id => !parts.has(id)) || !s.sourceIds.length || s.sourceIds.some(id => !sources.has(id)))) {
    throw new Error("The source-grounded plan has incomplete parts, citations, or safety conditions.");
  }
}
export function validateMapping(plan: RepairPlan, mapping: Mapping, nodeNames: string[], semantic = true) {
  const nodes = new Set(nodeNames);
  const assigned = new Set<string>();
  const required = new Set(plan.steps.flatMap(s => s.partIds));
  if (new Set(mapping.parts.map(p => p.id)).size !== mapping.parts.length) throw new Error("Duplicate mapped parts.");
  for (const part of mapping.parts) {
    const target = plan.parts.find(p => p.id === part.id);
    if (!target || !part.nodeNames.length || part.explodeOffset.length !== 3 ||
        part.explodeOffset.some(n => !Number.isFinite(n) || Math.abs(n) > 10)) throw new Error("Invalid part mapping.");
    for (const node of part.nodeNames) {
      if (!nodes.has(node) || assigned.has(node)) throw new Error("Missing or multiply assigned mesh.");
      // Generated labels must themselves identify the target, not merely be arbitrary mesh IDs.
      const label = normalize(target.label).split(" ").filter(w => w.length > 2);
      const nodeWords = normalize(node.replace(/([a-z])([A-Z])/g, "$1 $2")).split(" ");
      if (semantic && (!label.length || !label.every(word => nodeWords.includes(word)))) {
        throw new Error("mapping_unavailable: segmentation cannot establish the required component identity.");
      }
      assigned.add(node);
    }
    required.delete(part.id);
  }
  if (required.size) throw new Error("mapping_unavailable: actionable steps lack component targets.");
}
