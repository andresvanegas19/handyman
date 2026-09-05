import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { analysisResult, guide, outcome, part } from "./validators";
import { authTables } from "@convex-dev/auth/server";
import { mappingValidator, phaseValidator, planValidator, recognitionValidator, researchValidator } from "./repairContracts";

export default defineSchema({
  ...authTables,
  catalogProblems: defineTable({
    slug: v.string(), publishedVersionId: v.optional(v.id("guideVersions")),
  }).index("by_slug", ["slug"]),
  guideVersions: defineTable({
    guide, catalogId: v.id("catalogProblems"), assemblyId: v.optional(v.id("assemblies")),
    reviewedBy: v.optional(v.string()), reviewedAt: v.optional(v.number()),
    withdrawn: v.optional(v.boolean()),
  }).index("by_catalog", ["catalogId"]),
  problems: defineTable({
    workflow: v.optional(v.literal("visual")), activeRepairRunId: v.optional(v.id("repairRuns")),
    owner: v.string(), text: v.string(), consent: v.boolean(), transcript: v.string(),
    transcriptConfirmed: v.boolean(), revision: v.number(),
    state: v.union(v.literal("draft"), v.literal("transcribing"), v.literal("awaiting_transcript"),
      v.literal("analyzing"), v.literal("suggestions"), v.literal("follow_up"), v.literal("referral"), v.literal("failed")),
    activeJobId: v.optional(v.id("jobs")), failure: v.optional(v.string()), updatedAt: v.number(),
    selectedGuideVersionId: v.optional(v.id("guideVersions")),
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
    sceneId: v.optional(v.id("repairScenes")),
    state: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    attempts: v.number(), deadline: v.number(), failure: v.optional(v.string()),
    providerTaskId: v.optional(v.string()),
    tripoApiVersion: v.optional(v.union(v.literal("v2"), v.literal("v3"))),
  }).index("by_owner", ["owner"]).index("by_problem", ["problemId"]).index("by_state", ["state"])
    .index("by_provider_task", ["providerTaskId"]),
  repairScenes: defineTable({
    owner: v.string(), problemId: v.id("problems"), revision: v.number(),
    analysisId: v.id("analyses"), photoId: v.id("media"), jobId: v.id("jobs"),
    storageId: v.optional(v.id("_storage")), triangleCount: v.optional(v.number()),
  }).index("by_problem", ["problemId"]),
  assemblies: defineTable({
    status: v.union(v.literal("draft"), v.literal("reviewed")), prompt: v.string(),
    source: v.string(), license: v.string(), storageId: v.optional(v.id("_storage")),
    nodeNames: v.array(v.string()), triangleCount: v.number(), mappingReady: v.boolean(), parts: v.array(part),
    reviewedBy: v.optional(v.string()), reviewedAt: v.optional(v.number()),
    generatedByTripo: v.boolean(), uploadStorageId: v.optional(v.id("_storage")),
  }),
  assetUploads: defineTable({
    owner: v.string(), assemblyId: v.id("assemblies"), expiresAt: v.number(),
    storageId: v.optional(v.id("_storage")),
  }).index("by_owner", ["owner"]),
  feedback: defineTable({
    owner: v.string(), problemId: v.id("problems"), guideVersionId: v.id("guideVersions"),
    outcome, comment: v.string(), updatedAt: v.number(),
  }).index("by_identity", ["owner", "problemId", "guideVersionId"])
    .index("by_guide", ["guideVersionId"]).index("by_problem", ["problemId"]),
  quotas: defineTable({
    key: v.string(), window: v.number(), count: v.number(),
  }).index("by_key", ["key"]),
  repairRuns: defineTable({
    owner: v.string(), problemId: v.id("problems"), revision: v.number(), photoId: v.id("media"),
    phase: phaseValidator, resumePhase: v.optional(phaseValidator), message: v.optional(v.string()),
    retryable: v.boolean(), cacheHit: v.boolean(), deadline: v.number(), updatedAt: v.number(),
    activeStageId: v.optional(v.id("repairStages")), inputDigest: v.string(),
    recognition: v.optional(recognitionValidator), recognitionModel: v.optional(v.string()),
    research: v.optional(researchValidator), plan: v.optional(planValidator), planModel: v.optional(v.string()),
    mapping: v.optional(mappingValidator), mappingModel: v.optional(v.string()),
    generationTaskId: v.optional(v.string()), segmentationTaskId: v.optional(v.string()),
    modelStorageId: v.optional(v.id("_storage")), nodeNames: v.optional(v.array(v.string())),
    triangleCount: v.optional(v.number()), modelHash: v.optional(v.string()),
    solutionId: v.optional(v.id("repairSolutions")), sceneId: v.optional(v.id("repairSceneManifests")),
    referenceGuideId: v.optional(v.id("guideVersions")), referenceAssemblyId: v.optional(v.id("assemblies")),
  }).index("by_problem", ["problemId"]).index("by_owner_digest", ["owner", "inputDigest"]),
  repairStages: defineTable({
    runId: v.id("repairRuns"), phase: phaseValidator, attempt: v.number(),
    state: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    deadline: v.number(), paidSubmission: v.boolean(), ambiguous: v.boolean(),
    providerTaskId: v.optional(v.string()), pollAttempt: v.number(), failure: v.optional(v.string()),
  }).index("by_run", ["runId"]),
  repairSolutions: defineTable({
    owner: v.string(), problemId: v.id("problems"), revision: v.number(), plan: planValidator, research: researchValidator,
    recognition: recognitionValidator, policyVersion: v.string(), visibility: v.literal("private"), reviewed: v.boolean(),
    referenceGuideId: v.optional(v.id("guideVersions")),
  }).index("by_problem", ["problemId"]),
  repairSceneManifests: defineTable({
    owner: v.string(), problemId: v.id("problems"), revision: v.number(), storageId: v.id("_storage"),
    mapping: mappingValidator, nodeNames: v.array(v.string()), triangleCount: v.number(), hash: v.string(),
    source: v.union(v.literal("generated"), v.literal("reference")), validated: v.boolean(), policyVersion: v.string(),
    referenceAssemblyId: v.optional(v.id("assemblies")),
  }).index("by_problem", ["problemId"]).index("by_storage", ["storageId"]),
  repairCache: defineTable({
    scope: v.union(v.literal("owner"), v.literal("shared_reviewed")), owner: v.string(), key: v.string(),
    inputDigest: v.string(), recognition: recognitionValidator, policyVersion: v.string(), expiresAt: v.number(),
    state: v.union(v.literal("valid"), v.literal("invalid")),
    problemId: v.optional(v.id("problems")), revision: v.optional(v.number()),
    solutionId: v.optional(v.id("repairSolutions")), sceneId: v.optional(v.id("repairSceneManifests")),
    guideVersionId: v.optional(v.id("guideVersions")), assemblyId: v.optional(v.id("assemblies")),
    plan: v.optional(planValidator), research: v.optional(researchValidator),
  }).index("by_scope_owner_key", ["scope", "owner", "key"]).index("by_problem", ["problemId"]),
});
