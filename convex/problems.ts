import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { aiQuota, bounded, cancelProblemJobs, identity, ownProblem, quota } from "./lib";
import { removeRepairs } from "./repairLifecycle";

export const create = mutation({
  args: { text: v.string(), consent: v.boolean(), workflow: v.optional(v.literal("visual")), clientRequestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await identity(ctx);
    if (args.workflow === "visual" && (process.env.VISUAL_REPAIR_ENABLED !== "true" || !args.text.trim() || !args.consent)) {
      throw new ConvexError("Visual repair requires enabled service, a written description, and provider consent.");
    }
    const text = bounded(args.text, 4000, "Description");
    if (args.clientRequestId !== undefined) {
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(args.clientRequestId)) throw new ConvexError("Invalid client request ID.");
      const previous = await ctx.db.query("problems").withIndex("by_owner_request", q => q.eq("owner", user.subject).eq("clientRequestId", args.clientRequestId)).unique();
      if (previous) {
        if (previous.text !== text || previous.consent !== args.consent || previous.workflow !== args.workflow) {
          throw new ConvexError("This request ID already belongs to different inputs. Open the existing repair or begin a new request.");
        }
        return previous._id;
      }
    }
    await quota(ctx, `problem:${user.subject}`, 20);
    return await ctx.db.insert("problems", {
      owner: user.subject, text, consent: args.consent, clientRequestId: args.clientRequestId,
      ...(args.workflow ? { workflow: args.workflow } : {}),
      transcript: "", transcriptConfirmed: false, revision: 1, state: "draft", updatedAt: Date.now(),
    });
  },
});
export const list = query({
  args: {},
  handler: async ctx => {
    const user = await identity(ctx);
    const problems = await ctx.db.query("problems").withIndex("by_owner", q => q.eq("owner", user.subject)).order("desc").take(100);
    return await Promise.all(problems.map(async problem => {
      const run = problem.workflow === "visual" && problem.activeRepairRunId ? await ctx.db.get(problem.activeRepairRunId) : null;
      const visualPhase = !run ? undefined :
        run.owner === user.subject && run.revision === problem.revision && problem.consent ? run.phase : "cancelled" as const;
      return { ...problem, visualPhase };
    }));
  },
});
export const get = query({
  args: { problemId: v.id("problems") },
  handler: async (ctx, { problemId }) => {
    const problem = await ownProblem(ctx, problemId);
    const media = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    const analyses = await ctx.db.query("analyses").withIndex("by_problem", q => q.eq("problemId", problemId)).order("desc").collect();
    const analysis = analyses.find(a => a.revision === problem.revision) ?? null;
    const feedback = await ctx.db.query("feedback").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    return {
      problem,
      media: media.map(m => ({ _id: m._id, kind: m.kind, state: m.state, mime: m.mime, bytes: m.bytes, durationSeconds: m.durationSeconds })),
      analysis, feedback,
    };
  },
});
export const update = mutation({
  args: { problemId: v.id("problems"), text: v.string(), transcript: v.optional(v.string()), transcriptConfirmed: v.boolean() },
  handler: async (ctx, args) => {
    const problem = await ownProblem(ctx, args.problemId);
    const transcript = args.transcript === undefined ? problem.transcript : bounded(args.transcript, 8000, "Transcript");
    await cancelProblemJobs(ctx, problem._id);
    await ctx.db.patch(problem._id, {
      text: bounded(args.text, 4000, "Description"), transcript,
      transcriptConfirmed: args.transcriptConfirmed && transcript.length > 0,
      revision: problem.revision + 1, state: "draft", activeJobId: undefined,
      selectedGuideVersionId: undefined, failure: undefined, updatedAt: Date.now(),
    });
  },
});
export const setConsent = mutation({
  args: { problemId: v.id("problems"), consent: v.boolean() },
  handler: async (ctx, args) => {
    const problem = await ownProblem(ctx, args.problemId);
    await cancelProblemJobs(ctx, problem._id);
    await ctx.db.patch(problem._id, { consent: args.consent, revision: problem.revision + 1, state: "draft", activeJobId: undefined });
  },
});
export const selectGuide = mutation({
  args: { problemId: v.id("problems"), guideVersionId: v.id("guideVersions") },
  handler: async (ctx, args) => {
    const problem = await ownProblem(ctx, args.problemId);
    const analyses = await ctx.db.query("analyses").withIndex("by_problem", q => q.eq("problemId", problem._id)).order("desc").collect();
    const analysis = analyses.find(a => a.revision === problem.revision);
    const version = await ctx.db.get(args.guideVersionId);
    const catalog = version ? await ctx.db.get(version.catalogId) : null;
    if (!analysis?.result.guideVersionIds.includes(args.guideVersionId) || catalog?.publishedVersionId !== args.guideVersionId) {
      throw new ConvexError("Choose a currently published guide suggested for this problem revision.");
    }
    await ctx.db.patch(problem._id, { selectedGuideVersionId: args.guideVersionId, updatedAt: Date.now() });
  },
});
export const analyze = mutation({
  args: { problemId: v.id("problems") },
  handler: async (ctx, { problemId }) => {
    const problem = await ownProblem(ctx, problemId);
    if (problem.workflow === "visual") throw new ConvexError("Use the automatic visual repair workflow.");
    if (!problem.consent) throw new ConvexError("Consent to AI processing is required.");
    if (problem.state === "analyzing" && problem.activeJobId) return problem.activeJobId;
    const media = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    if (media.some(m => m.state === "reserved")) throw new ConvexError("Finish or remove pending uploads first.");
    if (media.some(m => m.kind === "audio") && !problem.transcriptConfirmed) throw new ConvexError("Review and confirm the transcript before analysis.");
    if (!problem.text && !problem.transcript && !media.some(m => m.kind === "photo")) throw new ConvexError("Add a description, photo, or confirmed transcript.");
    await quota(ctx, `analysis:${problem.owner}`, 10);
    await aiQuota(ctx);
    await cancelProblemJobs(ctx, problemId);
    const jobId = await ctx.db.insert("jobs", {
      owner: problem.owner, kind: "analysis", problemId, revision: problem.revision, state: "queued",
      attempts: 0, deadline: Date.now() + 180_000,
    });
    await ctx.db.patch(problemId, { activeJobId: jobId, state: "analyzing", failure: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.ai.analyze, { jobId });
    await ctx.scheduler.runAfter(180_000, internal.jobs.expire, { jobId });
    return jobId;
  },
});
export const transcribe = mutation({
  args: { problemId: v.id("problems") },
  handler: async (ctx, { problemId }) => {
    const problem = await ownProblem(ctx, problemId);
    if (problem.workflow === "visual") throw new ConvexError("Audio transcription belongs to the separate legacy workflow.");
    if (!problem.consent) throw new ConvexError("Consent to AI processing is required.");
    if (problem.state === "transcribing" && problem.activeJobId) return problem.activeJobId;
    const audio = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", problemId))
      .filter(q => q.and(q.eq(q.field("kind"), "audio"), q.eq(q.field("state"), "ready"))).first();
    if (!audio) throw new ConvexError("Upload an audio clip first.");
    await quota(ctx, `transcription:${problem.owner}`, 10);
    await aiQuota(ctx);
    await cancelProblemJobs(ctx, problemId);
    const jobId = await ctx.db.insert("jobs", {
      owner: problem.owner, kind: "transcription", problemId, revision: problem.revision,
      state: "queued", attempts: 0, deadline: Date.now() + 180_000,
    });
    await ctx.db.patch(problemId, { activeJobId: jobId, state: "transcribing", failure: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.ai.transcribe, { jobId });
    await ctx.scheduler.runAfter(180_000, internal.jobs.expire, { jobId });
    return jobId;
  },
});
export const remove = mutation({
  args: { problemId: v.id("problems") },
  handler: async (ctx, { problemId }) => {
    await ownProblem(ctx, problemId);
    await removeRepairs(ctx, problemId);
    const media = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    for (const item of media) {
      if (item.storageId) await ctx.storage.delete(item.storageId);
      await ctx.db.delete(item._id);
    }
    const analyses = await ctx.db.query("analyses").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    for (const item of analyses) await ctx.db.delete(item._id);
    const feedback = await ctx.db.query("feedback").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    for (const item of feedback) await ctx.db.delete(item._id);
    const jobs = await ctx.db.query("jobs").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    for (const item of jobs) await ctx.db.delete(item._id);
    const scenes = await ctx.db.query("repairScenes").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
    for (const scene of scenes) {
      if (scene.storageId) await ctx.storage.delete(scene.storageId);
      await ctx.db.delete(scene._id);
    }
    await ctx.db.delete(problemId);
  },
});
