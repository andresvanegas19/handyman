import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { analysisResult, guide, outcome, part } from "./validators";

export default defineSchema({
  catalogProblems: defineTable({
    slug: v.string(), publishedVersionId: v.optional(v.id("guideVersions")),
  }).index("by_slug", ["slug"]),
  guideVersions: defineTable({
    guide, catalogId: v.id("catalogProblems"), assemblyId: v.optional(v.id("assemblies")),
    reviewedBy: v.optional(v.string()), reviewedAt: v.optional(v.number()),
  }).index("by_catalog", ["catalogId"]),
  problems: defineTable({
    owner: v.string(), text: v.string(), consent: v.boolean(), transcript: v.string(),
    transcriptConfirmed: v.boolean(), revision: v.number(),
    state: v.union(v.literal("draft"), v.literal("transcribing"), v.literal("awaiting_transcript"),
      v.literal("analyzing"), v.literal("suggestions"), v.literal("follow_up"), v.literal("referral"), v.literal("failed")),
    activeJobId: v.optional(v.id("jobs")), failure: v.optional(v.string()), updatedAt: v.number(),
  }).index("by_owner", ["owner"]),
  media: defineTable({
    owner: v.string(), problemId: v.id("problems"), kind: v.union(v.literal("photo"), v.literal("audio")),
    state: v.union(v.literal("reserved"), v.literal("ready")),
    storageId: v.optional(v.id("_storage")), mime: v.optional(v.string()), bytes: v.optional(v.number()),
    durationSeconds: v.optional(v.number()), expiresAt: v.number(),
  }).index("by_problem", ["problemId"]).index("by_owner", ["owner"]),
  analyses: defineTable({
    problemId: v.id("problems"), owner: v.string(), revision: v.number(), jobId: v.id("jobs"),
    result: analysisResult, model: v.string(), promptVersion: v.string(),
  }).index("by_problem", ["problemId"]),
  jobs: defineTable({
    owner: v.string(), kind: v.union(v.literal("analysis"), v.literal("transcription"), v.literal("tripo")),
    problemId: v.optional(v.id("problems")), revision: v.optional(v.number()),
    assemblyId: v.optional(v.id("assemblies")),
    state: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    attempts: v.number(), deadline: v.number(), failure: v.optional(v.string()),
    providerTaskId: v.optional(v.string()),
  }).index("by_owner", ["owner"]).index("by_problem", ["problemId"]).index("by_state", ["state"])
    .index("by_provider_task", ["providerTaskId"]),
  assemblies: defineTable({
    status: v.union(v.literal("draft"), v.literal("reviewed")), prompt: v.string(),
    source: v.string(), license: v.string(), storageId: v.optional(v.id("_storage")),
    nodeNames: v.array(v.string()), triangleCount: v.number(), parts: v.array(part),
    reviewedBy: v.optional(v.string()), reviewedAt: v.optional(v.number()),
    generatedByTripo: v.boolean(), uploadStorageId: v.optional(v.id("_storage")),
  }),
  assetUploads: defineTable({
    owner: v.string(), assemblyId: v.id("assemblies"), expiresAt: v.number(),
  }).index("by_owner", ["owner"]),
  feedback: defineTable({
    owner: v.string(), problemId: v.id("problems"), guideVersionId: v.id("guideVersions"),
    outcome, comment: v.string(), updatedAt: v.number(),
  }).index("by_identity", ["owner", "problemId", "guideVersionId"])
    .index("by_guide", ["guideVersionId"]).index("by_problem", ["problemId"]),
  quotas: defineTable({
    key: v.string(), window: v.number(), count: v.number(),
  }).index("by_key", ["key"]),
});
