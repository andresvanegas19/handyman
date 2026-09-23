import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { admin, aiQuota, ownProblem, quota } from "./lib";
import {
  ACTIVE_PHASES, POLICY_VERSION, compatibilityKey, compatible, mappingValidator, phaseValidator,
  planValidator, recognitionValidator, researchValidator, validateMapping, validatePlan,
  textFingerprint, type RepairPhase,
} from "./repairContracts";
import { recognizeProduct, draftRepair, mapRepairParts } from "./openrouter";
import { providerFailureMessage, researchProduct } from "./firecrawl";
import { inspectRepairGeometry } from "./repairGeometry";
import { invalidateRepairs } from "./repairLifecycle";
import { repairErrorCode, repairLog } from "../src/lib/repair-log";
import { needsImmediateSafety, recommendationsValidator, repairRecommendations } from "./repairRecommendations";

const runArgs = { runId: v.id("repairRuns"), stageId: v.id("repairStages") };
const problemArgs = { problemId: v.id("problems") };
const phaseMessage: Partial<Record<RepairPhase, string>> = {
  recognizing: "Comparing your photo with the problem you described.", checking_cache: "Looking for a compatible, previously validated solution.",
  researching: "Looking up product documentation for your reported problem.", planning: "Matching your request to supported, source-backed repair options.",
  generating_model: "A supported draft is prepared. Building its interactive 3D reference.", segmenting: "Separating visible components.",
  mapping: "Matching repair steps to model components.", validating: "Verifying instructions and model readiness.",
};

export const configuration = internalQuery({
  args: {},
  returns: v.object({ enabled: v.boolean(), ready: v.boolean(), missing: v.array(v.string()) }),
  handler: async () => {
    const enabled = process.env.VISUAL_REPAIR_ENABLED === "true";
    const missing = enabled ? [] : ["VISUAL_REPAIR_ENABLED"];
    for (const key of ["FIRECRAWL_API_KEY", "OPENROUTER_API_KEY", "TRIPO_API_KEY", "TRIPO_MODEL_VERSION"]) {
      if (!process.env[key]?.trim()) missing.push(key);
    }
    for (const [key, max, fallback] of [
      ["FIRECRAWL_DAILY_LIMIT", 10_000, 0],
      ["TRIPO_DAILY_LIMIT", 100, 0],
      ["AI_DAILY_LIMIT", 10_000, 100],
    ] as const) {
      const limit = Number(process.env[key] ?? fallback);
      if (!Number.isInteger(limit) || limit < 1 || limit > max) missing.push(key);
    }
    const ready = missing.length === 0;
    repairLog("configuration.checked", { enabled, configured: ready, count: missing.length }, ready ? "info" : "warn");
    return { enabled, ready, missing };
  },
});

export async function currentRun(ctx: QueryCtx | MutationCtx, runId: Id<"repairRuns">) {
  const run = await ctx.db.get(runId);
  if (!run || !ACTIVE_PHASES.includes(run.phase) || run.deadline <= Date.now() || process.env.VISUAL_REPAIR_ENABLED !== "true") return null;
  const problem = await ctx.db.get(run.problemId);
  const photo = await ctx.db.get(run.photoId);
  if (!problem || problem.owner !== run.owner || !problem.consent || problem.workflow !== "visual" ||
      problem.revision !== run.revision || problem.activeRepairRunId !== run._id ||
      !photo || photo.problemId !== problem._id || photo.owner !== run.owner || photo.state !== "ready" || !photo.storageId) return null;
  return { run, problem, photo };
}
async function currentStage(ctx: QueryCtx | MutationCtx, runId: Id<"repairRuns">, stageId: Id<"repairStages">) {
  const input = await currentRun(ctx, runId);
  const stage = await ctx.db.get(stageId);
  if (!input || !stage || stage.runId !== runId || input.run.activeStageId !== stageId ||
      stage.phase !== input.run.phase || stage.deadline <= Date.now()) return null;
  return { ...input, stage };
}
async function enqueue(ctx: MutationCtx, runId: Id<"repairRuns">, phase: RepairPhase) {
  const previous = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", runId)).collect();
  const attempt = previous.filter(s => s.phase === phase).length + 1;
  if (attempt > 3) throw new ConvexError("This stage reached its three-attempt limit. Update the inputs or ask for support.");
  const deadline = Date.now() + (["generating_model", "segmenting"].includes(phase) ? 900_000 : 180_000);
  const stageId = await ctx.db.insert("repairStages", {
    runId, phase, attempt, deadline, state: "queued", paidSubmission: false, ambiguous: false, pollAttempt: 0,
  });
  const run = await ctx.db.get(runId);
  const message = run?.intent === "preview" && phase === "generating_model" ?
    "Building an approximate 3D reference from your photo, not a repair guide." : phaseMessage[phase];
  await ctx.db.patch(runId, { phase, activeStageId: stageId, message, updatedAt: Date.now(), retryable: false });
  await ctx.scheduler.runAfter(0, ["generating_model", "segmenting"].includes(phase) ? internal.repairModel.submit : internal.repairPipeline.work, { runId, stageId });
  await ctx.scheduler.runAfter(deadline - Date.now(), internal.repairPipeline.expire, { runId, stageId });
  repairLog("stage.queued", { runId, stageId, phase, attempt });
}
function needsImageRecognition(run: Doc<"repairRuns">) {
  return ["referral", "needs_input"].includes(run.phase) &&
    ["deterministic-safety-screen", "local-safety-screen"].includes(run.recognitionModel ?? "");
}
function canRetryAsPreview(run: Doc<"repairRuns">) {
  return !run.intent && (["referral", "needs_input"].includes(run.phase) ||
    (run.phase === "failed" && ["recognizing", "researching", "planning"].includes(run.resumePhase ?? "")));
}
async function begin(ctx: MutationCtx, problemId: Id<"problems">, retry: boolean) {
  const problem = await ownProblem(ctx, problemId);
  repairLog("run.requested", { problemId, workflow: problem.workflow ?? "legacy", enabled: process.env.VISUAL_REPAIR_ENABLED === "true", retryable: retry });
  if (process.env.VISUAL_REPAIR_ENABLED !== "true") throw new ConvexError("Visual repair is not enabled.");
  if (problem.workflow !== "visual" || !problem.consent || !problem.text.trim()) throw new ConvexError("A written description and provider consent are required.");
  const media = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  if (media.some(m => m.state === "reserved")) throw new ConvexError("Finish or remove pending uploads first.");
  const photo = media.find(m => m.owner === problem.owner && m.kind === "photo" && m.state === "ready" && m.storageId);
  if (!photo?.storageId) throw new ConvexError("Upload a supported photo before starting visual repair.");
  const existing = problem.activeRepairRunId ? await ctx.db.get(problem.activeRepairRunId) : null;
  if (existing?.revision === problem.revision) {
    if (ACTIVE_PHASES.includes(existing.phase) || existing.phase === "ready") {
      repairLog("run.reused", { problemId, runId: existing._id, phase: existing.phase });
      return existing._id;
    }
    if (!retry) return existing._id;
    const preview = !needsImageRecognition(existing) && canRetryAsPreview(existing);
    const resumePhase = needsImageRecognition(existing) ? "recognizing" : preview ? "generating_model" : existing.resumePhase;
    if ((!existing.retryable && !needsImageRecognition(existing) && !preview) || !resumePhase) throw new ConvexError(existing.message ?? "This run cannot be retried automatically.");
    await quota(ctx, `visual-retry:${problem.owner}`, 5);
    const stages = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", existing._id)).collect();
    if (stages.some(s => s.ambiguous && !s.providerTaskId)) throw new ConvexError("A paid request has an unknown outcome. Reconcile it with the provider; it will not be replayed.");
    await ctx.db.patch(existing._id, { deadline: Date.now() + 3_600_000 });
    const prior = existing.activeStageId ? await ctx.db.get(existing.activeStageId) : null;
    if (prior?.providerTaskId && ["generating_model", "segmenting"].includes(prior.phase)) {
      await ctx.db.patch(prior._id, { state: "running", deadline: Date.now() + 900_000, pollAttempt: 0, failure: undefined });
      await ctx.db.patch(existing._id, { phase: prior.phase, retryable: false, message: existing.intent === "preview" ?
        "Checking the existing approximate-model task without another paid submission." : phaseMessage[prior.phase] });
      await ctx.scheduler.runAfter(0, internal.repairModel.poll, { runId: existing._id, stageId: prior._id, attempt: 0 });
      await ctx.scheduler.runAfter(900_000, internal.repairPipeline.expire, { runId: existing._id, stageId: prior._id });
      repairLog("tripo.poll.resumed", { runId: existing._id, stageId: prior._id, phase: prior.phase, requestId: prior.providerTaskId });
    } else if (preview) {
      await queuePreview(ctx, existing, existing.message ?? "No supported repair guide was established.");
    } else await enqueue(ctx, existing._id, resumePhase);
    repairLog("run.resumed", { problemId, runId: existing._id, phase: resumePhase });
    return existing._id;
  }
  await quota(ctx, `visual-start:${problem.owner}`, 10);
  const metadata = await ctx.db.system.get(photo.storageId);
  if (!metadata) throw new ConvexError("The photo is no longer available.");
  // Storage hashes are calculated by Convex, not supplied by the browser.
  const inputDigest = `${POLICY_VERSION}|${metadata.sha256}|${textFingerprint(problem.text)}`;
  const runId = await ctx.db.insert("repairRuns", {
    owner: problem.owner, problemId, revision: problem.revision, photoId: photo._id, phase: "queued",
    retryable: false, cacheHit: false, deadline: Date.now() + 3_600_000, updatedAt: Date.now(), inputDigest,
  });
  await ctx.db.patch(problemId, { activeRepairRunId: runId, updatedAt: Date.now() });
  repairLog("run.created", { problemId, runId });
  const exact = await ctx.db.query("repairRuns").withIndex("by_owner_digest", q => q.eq("owner", problem.owner).eq("inputDigest", inputDigest)).take(30);
  for (const candidate of exact) {
    if (candidate._id === runId) continue;
    const source = await ctx.db.get(candidate.problemId);
    if (!source || source.text.trim().toLowerCase() !== problem.text.trim().toLowerCase()) continue;
    const stages = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", candidate._id)).collect();
    if (stages.some(s => s.ambiguous && !s.providerTaskId)) throw new ConvexError("An identical paid request has an unknown outcome. Reconcile it before submitting again.");
    if (!source.consent || source.revision !== candidate.revision || candidate.updatedAt < Date.now() - 86_400_000) continue;
    if (ACTIVE_PHASES.includes(candidate.phase)) throw new ConvexError("An identical repair is already processing. Open that repair instead.");
    if (candidate.phase !== "failed") continue;
    const segmented = stages.some(s => s.phase === "segmenting" && s.state === "succeeded");
    if (stages.some(s => s.providerTaskId && s.state !== "succeeded") && !segmented) {
      throw new ConvexError("An identical repair has an existing provider task. Retry that repair to reconcile it without another paid submission.");
    }
  }
  await enqueue(ctx, runId, "recognizing");
  return runId;
}
export const start = mutation({ args: problemArgs, handler: (ctx, { problemId }) => begin(ctx, problemId, false) });
export const retry = mutation({ args: problemArgs, handler: (ctx, { problemId }) => begin(ctx, problemId, true) });
export const cancel = mutation({
  args: problemArgs,
  handler: async (ctx, { problemId }) => {
    await ownProblem(ctx, problemId);
    await invalidateRepairs(ctx, problemId, "This repair was stopped.");
  },
});

async function referenceValid(ctx: QueryCtx | MutationCtx, guideId?: Id<"guideVersions">, assemblyId?: Id<"assemblies">) {
  if (!guideId && !assemblyId) return true;
  if (!guideId || !assemblyId) return false;
  const guide = await ctx.db.get(guideId);
  const assembly = await ctx.db.get(assemblyId);
  const catalog = guide ? await ctx.db.get(guide.catalogId) : null;
  return Boolean(guide && !guide.withdrawn && guide.guide.status === "published" && guide.reviewedAt &&
    catalog?.publishedVersionId === guideId && guide.assemblyId === assemblyId &&
    assembly?.status === "reviewed" && assembly.mappingReady && assembly.storageId);
}
async function readyArtifacts(ctx: QueryCtx | MutationCtx, run: Doc<"repairRuns">) {
  if (run.intent === "preview" || run.phase !== "ready" || !run.solutionId || !run.sceneId) return null;
  const problem = await ctx.db.get(run.problemId);
  const solution = await ctx.db.get(run.solutionId);
  const scene = await ctx.db.get(run.sceneId);
  if (!problem?.consent || problem.owner !== run.owner || problem.revision !== run.revision || problem.activeRepairRunId !== run._id ||
      !solution || !scene || scene.kind === "preview" || !scene.mapping || solution.owner !== run.owner || scene.owner !== run.owner ||
      solution.revision !== run.revision || scene.revision !== run.revision || !scene.validated ||
      solution.policyVersion !== POLICY_VERSION || scene.policyVersion !== POLICY_VERSION ||
      !await referenceValid(ctx, solution.referenceGuideId, scene.referenceAssemblyId) ||
      !await ctx.db.system.get(scene.storageId)) return null;
  if (scene.referenceAssemblyId) {
    const assembly = await ctx.db.get(scene.referenceAssemblyId);
    if (assembly?.storageId !== scene.storageId || JSON.stringify(assembly.parts) !== JSON.stringify(scene.mapping.parts)) return null;
  }
  return { solution, scene: { ...scene, mapping: scene.mapping } };
}
async function readyPreview(ctx: QueryCtx | MutationCtx, run: Doc<"repairRuns">) {
  if (run.phase !== "ready" || run.intent !== "preview" || !run.sceneId || run.solutionId) return null;
  const problem = await ctx.db.get(run.problemId);
  const scene = await ctx.db.get(run.sceneId);
  const photo = await ctx.db.get(run.photoId);
  if (!problem?.consent || problem.workflow !== "visual" || problem.owner !== run.owner ||
      problem.revision !== run.revision || problem.activeRepairRunId !== run._id ||
      !photo || photo.owner !== run.owner || photo.problemId !== problem._id || photo.state !== "ready" || !photo.storageId ||
      !scene || scene.kind !== "preview" || scene.mapping || scene.referenceAssemblyId || scene.source !== "generated" ||
      scene.problemId !== run.problemId || scene.owner !== run.owner || scene.revision !== run.revision ||
      !scene.validated || scene.policyVersion !== POLICY_VERSION ||
      !await ctx.db.system.get(scene.storageId)) return null;
  return scene;
}
const previewDisclaimer = "Approximate image-to-3D reference only, not a repair guide, diagnosis, exact parts match, or depiction of hidden components.";
async function queuePreview(ctx: MutationCtx, run: Doc<"repairRuns">, reason: string) {
  await ctx.db.patch(run._id, {
    intent: "preview", previewReason: reason.slice(0, 400), plan: undefined, mapping: undefined,
    solutionId: undefined, sceneId: undefined, referenceGuideId: undefined, referenceAssemblyId: undefined,
  });
  let storageId = !run.referenceAssemblyId ? run.modelStorageId : undefined;
  if (storageId && !await ctx.db.system.get(storageId)) storageId = undefined;
  if (!storageId) {
    const entries = await ctx.db.query("repairRuns").withIndex("by_owner_digest", q => q.eq("owner", run.owner).eq("inputDigest", run.inputDigest)).take(30);
    const problem = await ctx.db.get(run.problemId);
    for (const entry of entries) {
      if (entry._id === run._id || entry.updatedAt < Date.now() - 30 * 86_400_000) continue;
      const source = await ctx.db.get(entry.problemId);
      if (source?.text.trim().toLowerCase() !== problem?.text.trim().toLowerCase()) continue;
      const scene = await readyPreview(ctx, entry);
      if (!scene) continue;
      storageId = scene.storageId;
      await ctx.db.patch(run._id, {
        modelStorageId: scene.storageId, nodeNames: scene.nodeNames, triangleCount: scene.triangleCount,
        modelHash: scene.hash, cacheHit: true,
      });
      break;
    }
  }
  if (!storageId) await ctx.db.patch(run._id, { modelStorageId: undefined, nodeNames: undefined, modelHash: undefined, triangleCount: undefined });
  await enqueue(ctx, run._id, storageId ? "validating" : "generating_model");
  await ctx.db.patch(run._id, { message: `${reason.slice(0, 400)} ${previewDisclaimer}` });
}
async function copyRunArtifacts(ctx: MutationCtx, runId: Id<"repairRuns">, candidate: Doc<"repairRuns">) {
  const artifacts = await readyArtifacts(ctx, candidate);
  if (!artifacts) return false;
  await ctx.db.patch(runId, {
    research: artifacts.solution.research, plan: artifacts.solution.plan,
    mapping: artifacts.scene.mapping, modelStorageId: artifacts.scene.storageId, modelHash: artifacts.scene.hash,
    triangleCount: artifacts.scene.triangleCount, nodeNames: artifacts.scene.nodeNames,
    referenceGuideId: artifacts.solution.referenceGuideId, referenceAssemblyId: artifacts.scene.referenceAssemblyId, cacheHit: true,
  });
  return true;
}
const viewValidator = v.union(v.null(), v.object({
  phase: phaseValidator, message: v.optional(v.string()), retryable: v.boolean(), cacheHit: v.boolean(),
  recommendations: v.optional(recommendationsValidator),
  preview: v.optional(v.object({ id: v.string() })),
  solution: v.optional(v.object({
    title: v.string(), summary: v.string(), prerequisites: v.array(v.string()), stopConditions: v.array(v.string()),
    steps: planValidator.fields.steps, sources: v.array(v.object({ id: v.string(), url: v.string(), title: v.string() })),
  })),
  scene: v.optional(v.object({
    id: v.string(), parts: mappingValidator.fields.parts, source: v.union(v.literal("generated"), v.literal("reference")),
  })),
}));
export const get = query({
  args: problemArgs, returns: viewValidator,
  handler: async (ctx, { problemId }): Promise<Infer<typeof viewValidator>> => {
    const problem = await ownProblem(ctx, problemId);
    const run = problem.activeRepairRunId ? await ctx.db.get(problem.activeRepairRunId) : null;
    if (!run) return null;
    if (run.revision !== problem.revision || !problem.consent) return { phase: "cancelled" as const, retryable: false, cacheHit: false, message: "Inputs or consent changed." };
    const recommendations = run.phase === "cancelled" ? undefined :
      repairRecommendations(problem.text, run.recognition, run.research, run.recognitionModel);
    if (run.phase === "ready" && run.intent === "preview" && recommendations) {
      recommendations.items = [];
      recommendations.questions = [];
      recommendations.summary = recommendations.urgent
        ? "Prioritize immediate safety. If the reported danger is present, move away to safety and contact local emergency services or the relevant utility. Do not approach, operate, test, or disassemble the object. The approximate model is not a repair guide."
        : "Approximate visual context only. The photo and source links do not establish a diagnosis, repair procedure, exact model, or part compatibility.";
    }
    const result = { phase: run.phase, message: run.message, retryable: run.retryable || needsImageRecognition(run) || canRetryAsPreview(run), cacheHit: run.cacheHit, recommendations };
    if (run.phase !== "ready") return result;
    if (run.intent === "preview") {
      const preview = await readyPreview(ctx, run);
      return preview ? { ...result, preview: { id: preview._id } } : {
        ...result, phase: "failed" as const, retryable: false,
        message: "The approximate model is no longer available. No repair instructions were generated.",
      };
    }
    const artifacts = await readyArtifacts(ctx, run);
    if (!artifacts) {
      repairLog("model.unavailable", { problemId, runId: run._id, stageId: run.activeStageId, sceneId: run.sceneId, phase: run.phase, code: "stored_model_unavailable" }, "error");
      return { phase: "failed" as const, message: "The interactive model or reviewed reference is no longer available. Documentation and safe next steps remain available; mapped repair steps are not.", retryable: false, cacheHit: false, recommendations };
    }
    const { title, summary, prerequisites, stopConditions, steps } = artifacts.solution.plan;
    return {
      ...result, recommendations, solution: { title, summary, prerequisites, stopConditions, steps, sources: artifacts.solution.research.sources.map(({ id, url, title }) => ({ id, url, title })) },
      scene: { id: artifacts.scene._id, parts: artifacts.scene.mapping.parts, source: artifacts.scene.source },
    };
  },
});
export const reportViewerFailure = mutation({
  args: {
    problemId: v.id("problems"), sceneId: v.optional(v.string()),
    code: v.union(v.literal("model_missing"), v.literal("manifest_invalid"),
      v.literal("download_failed"), v.literal("download_timeout"), v.literal("render_failed"),
      v.literal("render_timeout"), v.literal("session_expired")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const problem = await ownProblem(ctx, args.problemId);
    const run = problem.activeRepairRunId ? await ctx.db.get(problem.activeRepairRunId) : null;
    if (!run || run.owner !== problem.owner || run.revision !== problem.revision ||
        !problem.consent || run.phase !== "ready") {
      throw new ConvexError("Viewer diagnostics require the current authorized ready repair.");
    }
    if ((args.sceneId !== undefined && args.sceneId !== run.sceneId) ||
        (args.sceneId === undefined && args.code !== "model_missing")) {
      throw new ConvexError("Viewer diagnostics do not match this repair's scene.");
    }
    await quota(ctx, `viewer-diagnostics:${problem.owner}`, 30, 60_000);
    repairLog("viewer.failed", {
      problemId: problem._id, runId: run._id, stageId: run.activeStageId,
      sceneId: run.sceneId, phase: run.phase, code: args.code, operation: "browser_report",
    }, "error");
    return null;
  },
});
export const privateSceneFile = internalQuery({
  args: { sceneId: v.string(), owner: v.string() },
  handler: async (ctx, { sceneId, owner }) => {
    const id = ctx.db.normalizeId("repairSceneManifests", sceneId);
    const scene = id ? await ctx.db.get(id) : null;
    if (!scene || scene.owner !== owner) return null;
    const problem = await ctx.db.get(scene.problemId);
    const run = problem?.activeRepairRunId ? await ctx.db.get(problem.activeRepairRunId) : null;
    if (!run || run.owner !== owner || run.sceneId !== id ||
        !(run.intent === "preview" ? await readyPreview(ctx, run) : await readyArtifacts(ctx, run))) return null;
    return { storageId: scene.storageId };
  },
});
export const input = internalQuery({
  args: runArgs,
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    return input?.stage.state === "running" ? input : null;
  },
});
export const claim = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "queued") return null;
    await ctx.db.patch(args.stageId, { state: "running" });
    repairLog("stage.started", { problemId: input.run.problemId, ...args, phase: input.run.phase, attempt: input.stage.attempt });
    return input;
  },
});
export const reserveProvider = internalMutation({
  args: { ...runArgs, provider: v.union(v.literal("ai"), v.literal("research"), v.literal("tripo")) },
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running" || input.stage.paidSubmission) return false;
    repairLog("provider.reservation.requested", { ...args, phase: input.run.phase, provider: args.provider });
    if (args.provider === "tripo") {
      const limit = Number(process.env.TRIPO_DAILY_LIMIT ?? 0);
      if (!process.env.TRIPO_API_KEY || !process.env.TRIPO_MODEL_VERSION || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ConvexError("Configure Tripo credentials, model, and TRIPO_DAILY_LIMIT (1–100).");
      await quota(ctx, "tripo:global", limit, 86_400_000);
      await quota(ctx, `visual-tripo:${input.run.owner}`, 6);
    } else if (args.provider === "research") {
      const limit = Number(process.env.FIRECRAWL_DAILY_LIMIT ?? 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new ConvexError("Configure FIRECRAWL_DAILY_LIMIT (1–10000).");
      await quota(ctx, "firecrawl:global", limit, 86_400_000);
      await quota(ctx, `visual-research:${input.run.owner}`, 10);
    } else {
      await aiQuota(ctx);
      await quota(ctx, `visual-ai:${input.run.owner}`, 30);
    }
    await ctx.db.patch(args.stageId, { paidSubmission: true, ambiguous: args.provider === "tripo" });
    repairLog("provider.reserved", { ...args, phase: input.run.phase, provider: args.provider });
    return true;
  },
});
export const fail = internalMutation({
  args: { ...runArgs, message: v.string(), retryable: v.boolean(), ambiguous: v.optional(v.boolean()), referral: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running") return;
    const ambiguous = args.ambiguous ?? (input.stage.ambiguous && !input.stage.providerTaskId);
    await ctx.db.patch(args.stageId, { state: "failed", failure: args.message.slice(0, 400), ambiguous });
    if (["recognizing", "researching", "planning"].includes(input.run.phase) && !ambiguous) {
      repairLog("stage.failed", { problemId: input.run.problemId, runId: args.runId, stageId: args.stageId, phase: input.run.phase, nextPhase: "generating_model", retryable: false, ambiguous: false }, "warn");
      const reason = input.run.phase === "recognizing" ? `Image caption unavailable. ${args.message}` : args.message;
      await queuePreview(ctx, input.run, reason);
      return;
    }
    await ctx.db.patch(args.runId, { phase: args.referral ? "referral" : "failed", resumePhase: input.run.phase, message: args.message.slice(0, 400), retryable: args.retryable && !ambiguous && !args.referral, updatedAt: Date.now() });
    repairLog("stage.failed", { problemId: input.run.problemId, runId: args.runId, stageId: args.stageId, phase: input.run.phase, nextPhase: args.referral ? "referral" : "failed", retryable: args.retryable && !ambiguous && !args.referral, ambiguous }, "error");
    repairLog("model.unavailable", { runId: args.runId, stageId: args.stageId, phase: input.run.phase, code: args.referral ? "unsafe_generation_blocked" : "stage_failed" }, "error");
  },
});
export const expire = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const stage = await ctx.db.get(args.stageId);
    if (!run || !stage || run.activeStageId !== stage._id || stage.deadline > Date.now() || !["queued", "running"].includes(stage.state)) return;
    const ambiguous = stage.paidSubmission && ["generating_model", "segmenting"].includes(stage.phase) && !stage.providerTaskId;
    await ctx.db.patch(stage._id, { state: "failed", ambiguous, failure: "Stage timed out." });
    await ctx.db.patch(run._id, { phase: "failed", resumePhase: stage.phase, retryable: !ambiguous, message: ambiguous ? "The paid submission outcome is unknown. Provider reconciliation is required; it will not be replayed." : "Processing timed out. Retry resumes valid completed work.", updatedAt: Date.now() });
    repairLog("stage.expired", { problemId: run.problemId, ...args, phase: stage.phase, code: "stage_deadline_exceeded", ambiguous, retryable: !ambiguous }, "error");
    repairLog("model.unavailable", { ...args, phase: stage.phase, code: "stage_deadline_exceeded" }, "error");
  },
});
export const complete = internalMutation({
  args: {
    ...runArgs, recognition: v.optional(recognitionValidator), research: v.optional(researchValidator),
    plan: v.optional(planValidator), mapping: v.optional(mappingValidator), model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running") return false;
    const { run } = input;
    let next: RepairPhase;
    if (run.phase === "recognizing" && args.recognition) {
      const r = args.recognition;
      await ctx.db.patch(run._id, { recognition: r, recognitionModel: args.model });
      if (r.outcome === "referral" && r.product.trim() && r.confidence >= 0.85 && !needsImmediateSafety(input.problem.text, r)) {
        next = "researching";
      } else if (r.outcome !== "identified" || r.confidence < 0.85 || needsImmediateSafety(input.problem.text, r)) {
        await ctx.db.patch(args.stageId, { state: "succeeded" });
        await queuePreview(ctx, run, needsImmediateSafety(input.problem.text, r) ?
          "Prioritize immediate safety and contact qualified help. Do not use the model to test, operate, or repair the object." :
          "The object or a safe applicable repair could not be established. No repair instructions are available.");
        return true;
      } else next = "checking_cache";
    } else if (run.phase === "researching" && args.research) {
      await ctx.db.patch(run._id, { research: args.research });
      if (run.recognition?.outcome === "referral" || !args.research.sources.length) {
        await ctx.db.patch(args.stageId, { state: "succeeded" });
        await queuePreview(ctx, run, args.research.sources.length
          ? "Found product documentation to review with a qualified professional. Hands-on instructions are not supported for this problem."
          : "No usable product documentation was found. Confirm the exact model and consult its manufacturer or a qualified professional.");
        repairLog("stage.completed", { problemId: run.problemId, runId: run._id, stageId: args.stageId, phase: "researching", nextPhase: "generating_model", count: args.research.sources.length });
        return true;
      }
      next = "planning";
    } else if (run.phase === "planning" && args.plan && run.research) {
      validatePlan(args.plan, run.research);
      await ctx.db.patch(run._id, { plan: args.plan, planModel: args.model });
      next = run.modelStorageId ? "mapping" : "generating_model";
    } else if (run.phase === "mapping" && args.mapping && run.plan && run.nodeNames) {
      validateMapping(run.plan, args.mapping, run.nodeNames, !run.referenceAssemblyId);
      await ctx.db.patch(run._id, { mapping: args.mapping, mappingModel: args.model });
      next = "validating";
    } else return false;
    await ctx.db.patch(args.stageId, { state: "succeeded" });
    repairLog("stage.completed", { problemId: run.problemId, runId: args.runId, stageId: args.stageId, phase: run.phase, nextPhase: next });
    await enqueue(ctx, run._id, next);
    return true;
  },
});
export const checkCache = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running" || input.run.phase !== "checking_cache" ||
        input.run.recognition?.outcome !== "identified" || input.run.recognition.confidence < 0.85) return;
    const { run } = input;
    const recognition = run.recognition!;
    const key = compatibilityKey(recognition);
    const privateEntries = await ctx.db.query("repairCache").withIndex("by_scope_owner_key", q => q.eq("scope", "owner").eq("owner", run.owner).eq("key", key)).take(30);
    const sharedEntries = await ctx.db.query("repairCache").withIndex("by_scope_owner_key", q => q.eq("scope", "shared_reviewed").eq("owner", "").eq("key", key)).take(30);
    let hit = false;
    for (const entry of [...privateEntries, ...sharedEntries]) {
      if (entry.state !== "valid" || entry.expiresAt <= Date.now() || entry.policyVersion !== POLICY_VERSION ||
          !compatible(entry.recognition, recognition)) continue;
      if (entry.scope === "owner") {
        // A private photo-derived reconstruction is only reused for identical image/text evidence.
        if (entry.inputDigest !== run.inputDigest || !entry.problemId) continue;
        const problem = await ctx.db.get(entry.problemId);
        if (problem?.text.trim().toLowerCase() !== input.problem.text.trim().toLowerCase()) continue;
        const candidate = problem?.activeRepairRunId ? await ctx.db.get(problem.activeRepairRunId) : null;
        if (candidate && await copyRunArtifacts(ctx, run._id, candidate)) { hit = true; break; }
      } else if (entry.plan && entry.research && await referenceValid(ctx, entry.guideVersionId, entry.assemblyId)) {
        const assembly = entry.assemblyId ? await ctx.db.get(entry.assemblyId) : null;
        if (!assembly?.storageId) continue;
        const file = await ctx.db.system.get(assembly.storageId);
        if (!file) continue;
        try { validatePlan(entry.plan, entry.research); validateMapping(entry.plan, { parts: assembly.parts }, assembly.nodeNames, false); } catch { continue; }
        await ctx.db.patch(run._id, {
          plan: entry.plan, research: entry.research, mapping: { parts: assembly.parts }, nodeNames: assembly.nodeNames,
          triangleCount: assembly.triangleCount, modelStorageId: assembly.storageId, modelHash: file.sha256,
          referenceGuideId: entry.guideVersionId, referenceAssemblyId: entry.assemblyId, cacheHit: true,
        });
        hit = true; break;
      }
    }
    let next: RepairPhase = hit ? "validating" : "researching";
    let partialHit = false;
    if (!hit) {
      const partials = await ctx.db.query("repairRuns").withIndex("by_owner_digest", q => q.eq("owner", run.owner).eq("inputDigest", run.inputDigest)).take(30);
      for (const candidate of partials) {
        if (candidate._id === run._id || candidate.intent === "preview" || candidate.phase !== "failed" || !candidate.recognition ||
            !compatible(candidate.recognition, recognition) || candidate.updatedAt < Date.now() - 86_400_000) continue;
        const source = await ctx.db.get(candidate.problemId);
        if (!source?.consent || source.revision !== candidate.revision || source.text.trim().toLowerCase() !== input.problem.text.trim().toLowerCase()) continue;
        const stages = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", candidate._id)).collect();
        if (stages.some(s => s.ambiguous && !s.providerTaskId)) continue;
        const segmented = stages.some(s => s.phase === "segmenting" && s.state === "succeeded") &&
          !!candidate.modelStorageId && !!await ctx.db.system.get(candidate.modelStorageId);
        if (!candidate.research && !candidate.plan && !segmented) continue;
        await ctx.db.patch(run._id, {
          research: candidate.research, plan: candidate.plan, planModel: candidate.planModel,
          ...(segmented ? {
            modelStorageId: candidate.modelStorageId, nodeNames: candidate.nodeNames,
            triangleCount: candidate.triangleCount, modelHash: candidate.modelHash,
          } : {}),
          cacheHit: true,
        });
        next = candidate.plan ? segmented ? "mapping" : "generating_model" : candidate.research ? "planning" : "researching";
        partialHit = true;
        break;
      }
    }
    await ctx.db.patch(args.stageId, { state: "succeeded" });
    repairLog("cache.checked", { problemId: run.problemId, ...args, cacheHit: hit || partialHit, status: hit ? "complete_hit" : partialHit ? "partial_hit" : "miss", nextPhase: next });
    await enqueue(ctx, run._id, next);
  },
});
export const commitReady = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running" || input.run.phase !== "validating") return false;
    const r = input.run;
    if (r.intent === "preview") {
      if (!r.modelStorageId || !r.nodeNames || !r.modelHash || !r.triangleCount ||
          r.plan || r.mapping || r.referenceAssemblyId || !await ctx.db.system.get(r.modelStorageId)) return false;
      const sceneId = await ctx.db.insert("repairSceneManifests", {
        owner: r.owner, problemId: r.problemId, revision: r.revision, storageId: r.modelStorageId,
        kind: "preview", nodeNames: r.nodeNames, triangleCount: r.triangleCount, hash: r.modelHash,
        validated: true, policyVersion: POLICY_VERSION, source: "generated",
      });
      await ctx.db.patch(args.stageId, { state: "succeeded" });
      await ctx.db.patch(r._id, {
        phase: "ready", sceneId, solutionId: undefined, retryable: false,
        message: `${r.previewReason ?? "A supported repair guide is unavailable."} ${previewDisclaimer}`, updatedAt: Date.now(),
      });
      repairLog("run.ready", { problemId: r.problemId, ...args, sceneId, cacheHit: r.cacheHit, count: 0 });
      return true;
    }
    if (!r.plan || !r.research || !r.recognition || !r.mapping || !r.modelStorageId || !r.nodeNames || !r.modelHash || !r.triangleCount) return false;
    if (!await referenceValid(ctx, r.referenceGuideId, r.referenceAssemblyId) || !await ctx.db.system.get(r.modelStorageId)) throw new Error("Reference or stored model is unavailable.");
    if (r.referenceAssemblyId) {
      const assembly = await ctx.db.get(r.referenceAssemblyId);
      if (assembly?.storageId !== r.modelStorageId || JSON.stringify(assembly.parts) !== JSON.stringify(r.mapping.parts)) throw new Error("The reviewed reference changed.");
    }
    validatePlan(r.plan, r.research); validateMapping(r.plan, r.mapping, r.nodeNames, !r.referenceAssemblyId);
    const solutionId = await ctx.db.insert("repairSolutions", {
      owner: r.owner, problemId: r.problemId, revision: r.revision, plan: r.plan, research: r.research,
      recognition: r.recognition, policyVersion: POLICY_VERSION, visibility: "private", reviewed: !!r.referenceGuideId,
      referenceGuideId: r.referenceGuideId,
    });
    const sceneId = await ctx.db.insert("repairSceneManifests", {
      owner: r.owner, problemId: r.problemId, revision: r.revision, storageId: r.modelStorageId, mapping: r.mapping,
      nodeNames: r.nodeNames, triangleCount: r.triangleCount, hash: r.modelHash, validated: true, policyVersion: POLICY_VERSION,
      source: r.referenceAssemblyId ? "reference" : "generated", referenceAssemblyId: r.referenceAssemblyId,
    });
    await ctx.db.insert("repairCache", {
      scope: "owner", owner: r.owner, key: compatibilityKey(r.recognition), inputDigest: r.inputDigest,
      recognition: r.recognition, policyVersion: POLICY_VERSION, expiresAt: Date.now() + 30 * 86_400_000, state: "valid",
      problemId: r.problemId, revision: r.revision, solutionId, sceneId,
    });
    await ctx.db.patch(args.stageId, { state: "succeeded" });
    await ctx.db.patch(r._id, { phase: "ready", solutionId, sceneId, retryable: false, message: undefined, updatedAt: Date.now() });
    repairLog("run.ready", { problemId: r.problemId, ...args, sceneId, cacheHit: r.cacheHit, count: r.plan.steps.length });
    return true;
  },
});
export const work = internalAction({
  args: runArgs,
  handler: async (ctx, args): Promise<void> => {
    if (!await ctx.runMutation(internal.repairPipeline.claim, args)) {
      repairLog("stage.skipped", { ...args, code: "stale_or_already_claimed" });
      return;
    }
    const input = await ctx.runQuery(internal.repairPipeline.input, args);
    if (!input) return;
    const startedAt = Date.now();
    try {
      const r = input.run;
      if (r.phase === "checking_cache") { await ctx.runMutation(internal.repairPipeline.checkCache, args); return; }
      if (r.phase === "validating") {
        if (!r.modelStorageId || (r.intent !== "preview" && (!r.plan || !r.mapping))) throw new Error("Model validation is incomplete.");
        const blob = await ctx.storage.get(r.modelStorageId);
        if (!blob) throw new Error("Stored model unavailable.");
        inspectRepairGeometry(new Uint8Array(await blob.arrayBuffer()), r.intent === "preview" ? undefined : r.mapping);
        if (!await ctx.runMutation(internal.repairPipeline.commitReady, args)) throw new Error("Readiness validation failed.");
        return;
      }
      if (!await ctx.runMutation(internal.repairPipeline.reserveProvider, { ...args, provider: r.phase === "researching" ? "research" : "ai" })) return;
      if (r.phase === "recognizing") {
        const blob = await ctx.storage.get(input.photo.storageId!);
        if (!blob || blob.size > 10 * 1024 * 1024) throw new Error("Source photo unavailable.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        if (!await ctx.runQuery(internal.repairPipeline.input, args)) return;
        const result = await recognizeProduct(input.problem.text, `data:${input.photo.mime};base64,${btoa(binary)}`);
        await ctx.runMutation(internal.repairPipeline.complete, { ...args, ...result });
      } else if (r.phase === "researching" && r.recognition) {
        const research = await researchProduct(r.recognition);
        await ctx.runMutation(internal.repairPipeline.complete, { ...args, research });
      } else if (r.phase === "planning" && r.recognition && r.research) {
        const result = await draftRepair(r.recognition, r.research, input.problem.text);
        await ctx.runMutation(internal.repairPipeline.complete, { ...args, ...result });
      } else if (r.phase === "mapping" && r.plan && r.nodeNames) {
        const result = await mapRepairParts(r.plan, r.nodeNames);
        await ctx.runMutation(internal.repairPipeline.complete, { ...args, ...result });
      } else throw new Error("Stage prerequisites are missing.");
    } catch (error) {
      const code = repairErrorCode(error);
      repairLog("stage.error", { problemId: input.run.problemId, ...args, phase: input.run.phase, elapsedMs: Date.now() - startedAt, code }, "error");
      const providerIssue = code.startsWith("provider_http_") || [
        "model_or_budget_unavailable", "missing_openrouter_key", "missing_firecrawl_key",
        "invalid_configuration", "request_failed_or_timed_out",
      ].includes(code);
      const mapping = (input.run.phase === "mapping" || input.run.phase === "validating") && !providerIssue;
      const referral = error instanceof Error && [
        "Repair instructions require a reviewed safety policy for this procedure.",
        "Repair plan exceeds supported low-risk external work.",
        "This problem exceeds supported low-risk repairs.",
        "Mechanical repair applicability, visible screw access, or source prerequisites are not established.",
        "Repeated tightening of the same target is not supported.",
        "No supported source-grounded repair was found.",
      ].includes(error.message);
      await ctx.runMutation(internal.repairPipeline.fail, {
        ...args, referral, retryable: !mapping && !referral,
        message: referral ? "No supported source-grounded procedure was established for your request. This procedure needs reviewed guidance. Review the documentation and next steps below; do not substitute an unrelated cleaning task or infer a repair from a generated model." :
          mapping ? input.run.intent === "preview" ? "The approximate model has invalid or invisible geometry and cannot be displayed." :
            "mapping_unavailable: the model cannot safely identify every required component. Use a clearer image or a reviewed reference." :
          error instanceof Error && error.message.includes("DAILY_LIMIT") ? error.message :
            providerFailureMessage(error, input.run.phase === "researching" ? "Firecrawl" : "OpenRouter"),
      });
    }
  },
});

export const registerReviewedReference = mutation({
  args: {
    guideVersionId: v.id("guideVersions"), recognition: recognitionValidator, research: researchValidator,
    safetyReviewed: v.boolean(), rightsReviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    await admin(ctx);
    const guide = await ctx.db.get(args.guideVersionId);
    if (!args.safetyReviewed || !args.rightsReviewed || !guide?.assemblyId ||
        !await referenceValid(ctx, guide._id, guide.assemblyId) || args.recognition.outcome !== "identified") {
      throw new ConvexError("A currently reviewed guide/model and explicit applicability, safety, and rights review are required.");
    }
    const assembly = (await ctx.db.get(guide.assemblyId))!;
    const plan = {
      title: guide.guide.title, summary: guide.guide.summary, prerequisites: guide.guide.prerequisites,
      stopConditions: guide.guide.stopConditions, parts: assembly.parts.map(({ id, label, description }) => ({ id, label, description })),
      steps: guide.guide.steps.map((s, i) => ({ id: `step-${i + 1}`, title: s.title, description: s.description, partIds: s.partIds, sourceIds: args.research.sources.map(s => s.id) })),
    };
    validatePlan(plan, args.research); validateMapping(plan, { parts: assembly.parts }, assembly.nodeNames, false);
    return await ctx.db.insert("repairCache", {
      scope: "shared_reviewed", owner: "", key: compatibilityKey(args.recognition), inputDigest: "", recognition: args.recognition,
      policyVersion: POLICY_VERSION, expiresAt: Date.now() + 90 * 86_400_000, state: "valid",
      guideVersionId: guide._id, assemblyId: guide.assemblyId, plan, research: args.research,
    });
  },
});
