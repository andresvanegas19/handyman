import { v } from "convex/values";

export const outcome = v.union(v.literal("worked"), v.literal("partly"), v.literal("not_worked"));
export const category = v.union(v.literal("Doors & windows"), v.literal("Furniture"), v.literal("Plumbing"));
export const guide = v.object({
  slug: v.string(), title: v.string(), summary: v.string(), category,
  difficulty: v.literal("Easy"), duration: v.string(), symptoms: v.array(v.string()),
  tools: v.array(v.string()), prerequisites: v.array(v.string()), stopConditions: v.array(v.string()),
  steps: v.array(v.object({ title: v.string(), description: v.string(), partIds: v.array(v.string()) })),
  assemblyKind: v.optional(v.union(v.literal("hinge"), v.literal("knob"), v.literal("aerator"))),
  status: v.union(v.literal("draft"), v.literal("published")), version: v.number(),
});
export const part = v.object({
  id: v.string(), label: v.string(), description: v.string(), nodeNames: v.array(v.string()),
  explodeOffset: v.array(v.number()),
});
export const analysisResult = v.object({
  outcome: v.union(v.literal("suggestions"), v.literal("follow_up"), v.literal("referral")),
  summary: v.string(), evidence: v.array(v.string()), questions: v.array(v.string()),
  guideVersionIds: v.array(v.id("guideVersions")),
});
