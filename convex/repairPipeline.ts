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
import { researchProduct } from "./firecrawl";
import { inspectRepairGeometry } from "./repairGeometry";
import { invalidateRepairs } from "./repairLifecycle";

const runArgs = { runId: v.id("repairRuns"), stageId: v.id("repairStages") };
const problemArgs = { problemId: v.id("problems") };
const phaseMessage: Partial<Record<RepairPhase, string>> = {
  recognizing: "Identifying the product and checking safety.", checking_cache: "Checking compatible private and reviewed results.",
  researching: "Researching supporting sources.", planning: "Preparing source-grounded instructions.",
  generating_model: "Generating a private model.", segmenting: "Separating visible components.",
  mapping: "Matching repair steps to model components.", validating: "Verifying instructions and model readiness.",
};

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
  await ctx.db.patch(runId, { phase, activeStageId: stageId, message: phaseMessage[phase], updatedAt: Date.now(), retryable: false });
  await ctx.scheduler.runAfter(0, ["generating_model", "segmenting"].includes(phase) ? internal.repairModel.submit : internal.repairPipeline.work, { runId, stageId });
  await ctx.scheduler.runAfter(deadline - Date.now(), internal.repairPipeline.expire, { runId, stageId });
}
async function begin(ctx: MutationCtx, problemId: Id<"problems">, retry: boolean) {
  const problem = await ownProblem(ctx, problemId);
  if (process.env.VISUAL_REPAIR_ENABLED !== "true") throw new ConvexError("Visual repair is not enabled.");
  if (problem.workflow !== "visual" || !problem.consent || !problem.text.trim()) throw new ConvexError("A written description and provider consent are required.");
  const media = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  if (media.some(m => m.state === "reserved")) throw new ConvexError("Finish or remove pending uploads first.");
  const photo = media.find(m => m.owner === problem.owner && m.kind === "photo" && m.state === "ready" && m.storageId);
  if (!photo?.storageId) throw new ConvexError("Upload a supported photo before starting visual repair.");
  const existing = problem.activeRepairRunId ? await ctx.db.get(problem.activeRepairRunId) : null;
  if (existing?.revision === problem.revision) {
    if (ACTIVE_PHASES.includes(existing.phase) || existing.phase === "ready") return existing._id;
    if (!retry) return existing._id;
    if (!existing.retryable || !existing.resumePhase) throw new ConvexError(existing.message ?? "This run cannot be retried automatically.");
    await quota(ctx, `visual-retry:${problem.owner}`, 5);
    const stages = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", existing._id)).collect();
    if (stages.some(s => s.ambiguous && !s.providerTaskId)) throw new ConvexError("A paid request has an unknown outcome. Reconcile it with the provider; it will not be replayed.");
    await ctx.db.patch(existing._id, { deadline: Date.now() + 3_600_000 });
    const prior = existing.activeStageId ? await ctx.db.get(existing.activeStageId) : null;
    if (prior?.providerTaskId && ["generating_model", "segmenting"].includes(prior.phase)) {
      await ctx.db.patch(prior._id, { state: "running", deadline: Date.now() + 900_000, pollAttempt: 0, failure: undefined });
      await ctx.db.patch(existing._id, { phase: prior.phase, retryable: false, message: phaseMessage[prior.phase] });
      await ctx.scheduler.runAfter(0, internal.repairModel.poll, { runId: existing._id, stageId: prior._id, attempt: 0 });
      await ctx.scheduler.runAfter(900_000, internal.repairPipeline.expire, { runId: existing._id, stageId: prior._id });
    } else await enqueue(ctx, existing._id, existing.resumePhase);
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
  const exact = await ctx.db.query("repairRuns").withIndex("by_owner_digest", q => q.eq("owner", problem.owner).eq("inputDigest", inputDigest)).take(30);
  for (const candidate of exact) {
    const source = await ctx.db.get(candidate.problemId);
    if (source?.text.trim().toLowerCase() !== problem.text.trim().toLowerCase()) continue;
    if (candidate._id !== runId && candidate.updatedAt > Date.now() - 30 * 86_400_000 && await readyArtifacts(ctx, candidate)) {
      await copyRunArtifacts(ctx, runId, candidate);
      await enqueue(ctx, runId, "validating");
      return runId;
    }
  }
  for (const candidate of exact) {
    if (candidate._id === runId) continue;
    const source = await ctx.db.get(candidate.problemId);
    if (!source?.consent || source.text.trim().toLowerCase() !== problem.text.trim().toLowerCase() ||
        source.revision !== candidate.revision || candidate.updatedAt < Date.now() - 86_400_000) continue;
    const stages = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", candidate._id)).collect();
    if (stages.some(s => s.ambiguous && !s.providerTaskId)) throw new ConvexError("An identical paid request has an unknown outcome. Reconcile it before submitting again.");
    if (ACTIVE_PHASES.includes(candidate.phase)) throw new ConvexError("An identical repair is already processing. Open that repair instead.");
    if (candidate.phase !== "failed" || !candidate.recognition || candidate.recognition.outcome !== "identified") continue;
    // Reuse only completed, still-authorized stages; never copy an unvalidated model as a ready scene.
    const segmented = stages.some(s => s.phase === "segmenting" && s.state === "succeeded");
    if (stages.some(s => s.providerTaskId && s.state !== "succeeded") && !segmented) {
      throw new ConvexError("An identical repair has an existing provider task. Retry that repair to reconcile it without another paid submission.");
    }
    await ctx.db.patch(runId, {
      recognition: candidate.recognition, recognitionModel: candidate.recognitionModel,
      research: candidate.research, plan: candidate.plan, planModel: candidate.planModel,
      ...(candidate.modelStorageId && segmented ? {
        modelStorageId: candidate.modelStorageId, nodeNames: candidate.nodeNames,
        triangleCount: candidate.triangleCount, modelHash: candidate.modelHash,
      } : {}),
      cacheHit: true,
    });
    await enqueue(ctx, runId, candidate.plan ? candidate.modelStorageId && segmented ? "mapping" : "generating_model" : candidate.research ? "planning" : "checking_cache");
    return runId;
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
    await invalidateRepairs(ctx, problemId);
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
  if (run.phase !== "ready" || !run.solutionId || !run.sceneId) return null;
  const problem = await ctx.db.get(run.problemId);
  const solution = await ctx.db.get(run.solutionId);
  const scene = await ctx.db.get(run.sceneId);
  if (!problem?.consent || problem.owner !== run.owner || problem.revision !== run.revision || problem.activeRepairRunId !== run._id ||
      !solution || !scene || solution.owner !== run.owner || scene.owner !== run.owner ||
      solution.revision !== run.revision || scene.revision !== run.revision || !scene.validated ||
      solution.policyVersion !== POLICY_VERSION || scene.policyVersion !== POLICY_VERSION ||
      !await referenceValid(ctx, solution.referenceGuideId, scene.referenceAssemblyId) ||
      !await ctx.db.system.get(scene.storageId)) return null;
  if (scene.referenceAssemblyId) {
    const assembly = await ctx.db.get(scene.referenceAssemblyId);
    if (assembly?.storageId !== scene.storageId || JSON.stringify(assembly.parts) !== JSON.stringify(scene.mapping.parts)) return null;
  }
  return { solution, scene };
}
async function copyRunArtifacts(ctx: MutationCtx, runId: Id<"repairRuns">, candidate: Doc<"repairRuns">) {
  const artifacts = await readyArtifacts(ctx, candidate);
  if (!artifacts) return false;
  await ctx.db.patch(runId, {
    recognition: artifacts.solution.recognition, research: artifacts.solution.research, plan: artifacts.solution.plan,
    mapping: artifacts.scene.mapping, modelStorageId: artifacts.scene.storageId, modelHash: artifacts.scene.hash,
    triangleCount: artifacts.scene.triangleCount, nodeNames: artifacts.scene.nodeNames,
    referenceGuideId: artifacts.solution.referenceGuideId, referenceAssemblyId: artifacts.scene.referenceAssemblyId, cacheHit: true,
  });
  return true;
}
const viewValidator = v.union(v.null(), v.object({
  phase: phaseValidator, message: v.optional(v.string()), retryable: v.boolean(), cacheHit: v.boolean(),
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
    const result = { phase: run.phase, message: run.message, retryable: run.retryable, cacheHit: run.cacheHit };
    if (run.phase !== "ready") return result;
    const artifacts = await readyArtifacts(ctx, run);
    if (!artifacts) return { phase: "failed" as const, message: "This model or reviewed reference is no longer available.", retryable: false, cacheHit: false };
    const { title, summary, prerequisites, stopConditions, steps } = artifacts.solution.plan;
    return {
      ...result, solution: { title, summary, prerequisites, stopConditions, steps, sources: artifacts.solution.research.sources.map(({ id, url, title }) => ({ id, url, title })) },
      scene: { id: artifacts.scene._id, parts: artifacts.scene.mapping.parts, source: artifacts.scene.source },
    };
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
    if (!run || run.owner !== owner || run.sceneId !== id || !await readyArtifacts(ctx, run)) return null;
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
    return input;
  },
});
export const reserveProvider = internalMutation({
  args: { ...runArgs, provider: v.union(v.literal("ai"), v.literal("research"), v.literal("tripo")) },
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running" || input.stage.paidSubmission) return false;
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
    return true;
  },
});
export const fail = internalMutation({
  args: { ...runArgs, message: v.string(), retryable: v.boolean(), ambiguous: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running") return;
    const ambiguous = args.ambiguous ?? (input.stage.ambiguous && !input.stage.providerTaskId);
    await ctx.db.patch(args.stageId, { state: "failed", failure: args.message.slice(0, 400), ambiguous });
    await ctx.db.patch(args.runId, { phase: "failed", resumePhase: input.run.phase, message: args.message.slice(0, 400), retryable: args.retryable && !ambiguous, updatedAt: Date.now() });
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
      if (r.outcome !== "identified" || r.confidence < 0.85) {
        await ctx.db.patch(run._id, { phase: r.outcome === "referral" ? "referral" : "needs_input", message: r.summary, retryable: false });
        await ctx.db.patch(args.stageId, { state: "succeeded" });
        return true;
      }
      next = "checking_cache";
    } else if (run.phase === "researching" && args.research) {
      if (!args.research.sources.length) throw new Error("No supporting evidence was found.");
      await ctx.db.patch(run._id, { research: args.research });
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
    await enqueue(ctx, run._id, next);
    return true;
  },
});
export const checkCache = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running" || input.run.phase !== "checking_cache" || !input.run.recognition) return;
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
    await ctx.db.patch(args.stageId, { state: "succeeded" });
    await enqueue(ctx, run._id, hit ? "validating" : "researching");
  },
});
export const commitReady = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const input = await currentStage(ctx, args.runId, args.stageId);
    if (!input || input.stage.state !== "running" || input.run.phase !== "validating") return false;
    const r = input.run;
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
    return true;
  },
});
export const work = internalAction({
  args: runArgs,
  handler: async (ctx, args): Promise<void> => {
    if (!await ctx.runMutation(internal.repairPipeline.claim, args)) return;
    const input = await ctx.runQuery(internal.repairPipeline.input, args);
    if (!input) return;
    try {
      const r = input.run;
      if (r.phase === "checking_cache") { await ctx.runMutation(internal.repairPipeline.checkCache, args); return; }
      if (r.phase === "validating") {
        if (!r.modelStorageId || !r.plan || !r.mapping) throw new Error("Model validation is incomplete.");
        const blob = await ctx.storage.get(r.modelStorageId);
        if (!blob) throw new Error("Stored model unavailable.");
        inspectRepairGeometry(new Uint8Array(await blob.arrayBuffer()), r.mapping);
        if (!await ctx.runMutation(internal.repairPipeline.commitReady, args)) throw new Error("Readiness validation failed.");
        return;
      }
      if (!await ctx.runMutation(internal.repairPipeline.reserveProvider, { ...args, provider: r.phase === "researching" ? "research" : "ai" })) return;
      if (r.phase === "recognizing") {
        if (/\b(gas leak|live wir(?:e|ing)|mains voltage|asbestos|structural damage|burning smell|swollen battery)\b/i.test(input.problem.text)) {
          await ctx.runMutation(internal.repairPipeline.complete, { ...args, model: "local-safety-screen", recognition: {
            outcome: "referral", summary: "Stop and contact a qualified professional. This description may involve a serious hazard.",
            product: "", brand: "", model: "", variant: "", symptom: "", features: [], prerequisites: [], confidence: 1,
          } }); return;
        }
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
        const result = await draftRepair(r.recognition, r.research);
        await ctx.runMutation(internal.repairPipeline.complete, { ...args, ...result });
      } else if (r.phase === "mapping" && r.plan && r.nodeNames) {
        const result = await mapRepairParts(r.plan, r.nodeNames);
        await ctx.runMutation(internal.repairPipeline.complete, { ...args, ...result });
      } else throw new Error("Stage prerequisites are missing.");
    } catch (error) {
      const mapping = input.run.phase === "mapping" || input.run.phase === "validating";
      await ctx.runMutation(internal.repairPipeline.fail, {
        ...args, retryable: !mapping, message: mapping ? "mapping_unavailable: the model cannot safely identify every required component. Use a clearer image or a reviewed reference." :
          error instanceof Error && error.message.includes("DAILY_LIMIT") ? error.message : "Provider processing failed. Check configuration or retry; completed stages are retained.",
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
