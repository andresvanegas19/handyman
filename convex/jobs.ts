import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { analysisResult } from "./validators";

export async function current(ctx: MutationCtx, jobId: Id<"jobs">) {
  const job = await ctx.db.get(jobId);
  if (!job || (job.state !== "running" && job.state !== "queued") || job.deadline < Date.now()) return null;
  if (job.problemId) {
    const problem = await ctx.db.get(job.problemId);
    if (!problem || !problem.consent || problem.revision !== job.revision) return null;
    if (job.sceneId ? problem.state !== "suggestions" : problem.activeJobId !== jobId) return null;
  }
  return job;
}
export const claim = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await current(ctx, args.jobId);
    if (!job || job.state !== "queued") return null;
    await ctx.db.patch(job._id, { state: "running", attempts: job.attempts + 1 });
    return job;
  },
});
export const input = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state !== "running" || job.deadline < Date.now() || !job.problemId) return null;
    const problem = await ctx.db.get(job.problemId);
    if (!problem || !problem.consent || problem.activeJobId !== job._id || problem.revision !== job.revision) return null;
    const media = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", problem._id)).collect();
    const entries = await ctx.db.query("catalogProblems").collect();
    const guides = [];
    for (const entry of entries) {
      const version = entry.publishedVersionId ? await ctx.db.get(entry.publishedVersionId) : null;
      if (version?.guide.status === "published") guides.push(version);
    }
    return { job, problem, media: media.filter(m => m.state === "ready"), guides };
  },
});
export const completeAnalysis = internalMutation({
  args: { jobId: v.id("jobs"), result: analysisResult, model: v.string() },
  handler: async (ctx, args) => {
    const job = await current(ctx, args.jobId);
    if (!job?.problemId || job.state !== "running" || job.revision === undefined || job.kind !== "analysis") return false;
    for (const id of args.result.guideVersionIds) {
      const version = await ctx.db.get(id);
      const catalog = version ? await ctx.db.get(version.catalogId) : null;
      if (!version || version.guide.status !== "published" || catalog?.publishedVersionId !== id) {
        await ctx.db.patch(job._id, { state: "failed", failure: "The catalog changed. Please run analysis again." });
        await ctx.db.patch(job.problemId, { state: "failed", failure: "The catalog changed. Please run analysis again.", activeJobId: undefined });
        return false;
      }
    }
    await ctx.db.insert("analyses", {
      problemId: job.problemId, owner: job.owner, revision: job.revision, jobId: job._id,
      result: args.result, model: args.model, promptVersion: "catalog-only-v1",
    });
    await ctx.db.patch(job.problemId, { state: args.result.outcome, activeJobId: undefined, failure: undefined, updatedAt: Date.now() });
    await ctx.db.patch(job._id, { state: "succeeded" });
    return true;
  },
});
export const completeTranscript = internalMutation({
  args: { jobId: v.id("jobs"), transcript: v.string(), durationSeconds: v.number() },
  handler: async (ctx, args) => {
    const job = await current(ctx, args.jobId);
    if (!job?.problemId || job.state !== "running" || job.kind !== "transcription") return false;
    if (args.transcript.length > 8000 || args.durationSeconds > 60 || args.durationSeconds <= 0) return false;
    await ctx.db.patch(job.problemId, {
      transcript: args.transcript, transcriptConfirmed: false, state: "awaiting_transcript",
      activeJobId: undefined, failure: undefined, updatedAt: Date.now(),
    });
    await ctx.db.patch(job._id, { state: "succeeded" });
    return true;
  },
});
export const fail = internalMutation({
  args: { jobId: v.id("jobs"), message: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || (job.state !== "queued" && job.state !== "running")) return;
    await ctx.db.patch(job._id, { state: "failed", failure: args.message.slice(0, 300) });
    const problem = job.problemId ? await ctx.db.get(job.problemId) : null;
    if (problem && problem.activeJobId === job._id && problem.revision === job.revision) {
      await ctx.db.patch(problem._id, { state: "failed", failure: args.message.slice(0, 300), activeJobId: undefined, updatedAt: Date.now() });
    }
  },
});
export const expire = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.deadline > Date.now() || (job.state !== "queued" && job.state !== "running")) return;
    await ctx.db.patch(job._id, { state: "failed", failure: "Processing timed out. Retry explicitly when ready." });
    const problem = job.problemId ? await ctx.db.get(job.problemId) : null;
    if (problem?.activeJobId === job._id && problem.revision === job.revision) {
      await ctx.db.patch(problem._id, { state: "failed", failure: "Processing timed out. Please retry.", activeJobId: undefined });
    }
  },
});
