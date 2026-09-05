import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { admin, bounded, ownProblem, quota } from "./lib";
import { current } from "./jobs";
import { boundedDownload, inspectGlb } from "./glb";
import type { Doc, Id } from "./_generated/dataModel";

const base = "https://api.tripo3d.ai/v2/openapi/task";
const imageApi = "https://openapi.tripo3d.ai/v3";
const taskCreated = z.object({ code: z.literal(0), data: z.object({ task_id: z.string().min(1).max(200) }) });
const imageUploaded = z.object({ code: z.literal(0), data: z.object({ file_token: z.string().min(1).max(1000) }) });
const outputUrl = z.union([z.string(), z.object({ url: z.string() }), z.object({ model: z.string() })]);
const taskStatus = z.object({
  code: z.literal(0), data: z.object({
    task_id: z.string(), status: z.enum(["queued", "running", "success", "failed", "cancelled", "banned", "expired", "unknown"]),
    output: z.object({ model_url: z.string().optional(), pbr_model: outputUrl.optional(), model: outputUrl.optional() }).optional(),
  }),
});
function generationLimit() {
  if (!process.env.TRIPO_API_KEY || !process.env.TRIPO_MODEL_VERSION) throw new ConvexError("Configure TRIPO_API_KEY and TRIPO_MODEL_VERSION before generation.");
  const limit = Number(process.env.TRIPO_DAILY_LIMIT ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ConvexError("An administrator must configure TRIPO_DAILY_LIMIT (1–100) to authorize generation costs.");
  return limit;
}
async function eligibleAnalysis(ctx: QueryCtx, problem: Doc<"problems">) {
  if (!problem.consent || problem.state !== "suggestions") return null;
  const analyses = await ctx.db.query("analyses").withIndex("by_problem", q => q.eq("problemId", problem._id)).order("desc").collect();
  const analysis = analyses.find(a => a.revision === problem.revision);
  if (!analysis || analysis.result.outcome !== "suggestions" || !analysis.result.guideVersionIds.length) return null;
  for (const id of analysis.result.guideVersionIds) {
    const version = await ctx.db.get(id);
    const catalog = version ? await ctx.db.get(version.catalogId) : null;
    if (!version || version.withdrawn || version.guide.status !== "published" || catalog?.publishedVersionId !== id) return null;
  }
  return analysis;
}
export const scene = query({
  args: { problemId: v.id("problems") },
  handler: async (ctx, { problemId }) => {
    const problem = await ownProblem(ctx, problemId);
    const analysis = await eligibleAnalysis(ctx, problem);
    const limit = Number(process.env.TRIPO_DAILY_LIMIT ?? 0);
    const configured = Boolean(process.env.TRIPO_API_KEY && process.env.TRIPO_MODEL_VERSION && Number.isInteger(limit) && limit >= 1 && limit <= 100);
    const scenes = await ctx.db.query("repairScenes").withIndex("by_problem", q => q.eq("problemId", problemId)).order("desc").collect();
    const scene = scenes.find(s => s.revision === problem.revision && s.analysisId === analysis?._id);
    const job = scene ? await ctx.db.get(scene.jobId) : null;
    return {
      configured, eligible: Boolean(analysis),
      scene: scene && job ? {
        _id: scene._id, photoId: scene.photoId, state: job.state, failure: job.failure,
        ready: job.state === "succeeded" && Boolean(scene.storageId),
      } : null,
    };
  },
});
export const requestScene = mutation({
  args: { problemId: v.id("problems"), photoId: v.id("media"), consent: v.boolean() },
  handler: async (ctx, args) => {
    const problem = await ownProblem(ctx, args.problemId);
    if (!args.consent) throw new ConvexError("Consent to send the selected photo to Tripo is required.");
    const analysis = await eligibleAnalysis(ctx, problem);
    if (!analysis) throw new ConvexError("Complete a low-risk analysis with a currently reviewed guide before generating spatial context. Unsafe or uncertain repairs are blocked.");
    const photo = await ctx.db.get(args.photoId);
    if (!photo || photo.owner !== problem.owner || photo.problemId !== problem._id || photo.kind !== "photo" || photo.state !== "ready" || !photo.storageId) throw new ConvexError("Choose a ready photo belonging to this repair.");
    const scenes = await ctx.db.query("repairScenes").withIndex("by_problem", q => q.eq("problemId", problem._id)).order("desc").collect();
    const previous = scenes.find(s => s.revision === problem.revision && s.analysisId === analysis._id);
    if (previous) {
      const job = await ctx.db.get(previous.jobId);
      if (job && ["queued", "running", "succeeded"].includes(job.state)) return previous._id;
    }
    await quota(ctx, "tripo:global", generationLimit(), 86_400_000);
    await quota(ctx, `tripo:${problem.owner}`, 3);
    const jobId = await ctx.db.insert("jobs", {
      owner: problem.owner, kind: "tripo", problemId: problem._id, revision: problem.revision,
      state: "queued", attempts: 0, deadline: Date.now() + 900_000, tripoApiVersion: "v3",
    });
    const sceneId = await ctx.db.insert("repairScenes", {
      owner: problem.owner, problemId: problem._id, revision: problem.revision,
      analysisId: analysis._id, photoId: photo._id, jobId,
    });
    await ctx.db.patch(jobId, { sceneId });
    await ctx.scheduler.runAfter(0, internal.tripo.generate, { jobId });
    await ctx.scheduler.runAfter(900_000, internal.jobs.expire, { jobId });
    return sceneId;
  },
});
export const privateSceneFile = internalQuery({
  args: { sceneId: v.string(), owner: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("repairScenes", args.sceneId);
    const scene = id ? await ctx.db.get(id) : null;
    if (!scene || scene.owner !== args.owner || !scene.storageId) return null;
    const problem = await ctx.db.get(scene.problemId);
    if (!problem || problem.owner !== args.owner || problem.revision !== scene.revision) return null;
    const analysis = await eligibleAnalysis(ctx, problem);
    const job = await ctx.db.get(scene.jobId);
    return analysis?._id === scene.analysisId && job?.state === "succeeded" ? { storageId: scene.storageId } : null;
  },
});
export const request = mutation({
  args: { prompt: v.string(), source: v.string(), license: v.string() },
  handler: async (ctx, args) => {
    const user = await admin(ctx);
    await quota(ctx, "tripo:global", generationLimit(), 86_400_000);
    await quota(ctx, `tripo:${user.subject}`, 3);
    const prompt = bounded(args.prompt, 1500, "Prompt", 20);
    const source = bounded(args.source, 1000, "Source/provenance", 10);
    const license = bounded(args.license, 500, "Usage rights", 5);
    const assemblyId = await ctx.db.insert("assemblies", {
      status: "draft", prompt, source, license, nodeNames: [], triangleCount: 0,
      mappingReady: false, parts: [], generatedByTripo: false,
    });
    const jobId = await ctx.db.insert("jobs", {
      owner: user.subject, kind: "tripo", assemblyId, state: "queued", attempts: 0, deadline: Date.now() + 900_000,
    });
    await ctx.scheduler.runAfter(0, internal.tripo.generate, { jobId });
    await ctx.scheduler.runAfter(900_000, internal.jobs.expire, { jobId });
    return { jobId, assemblyId };
  },
});
export const data = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.kind !== "tripo" || job.state !== "running" || job.deadline < Date.now()) return null;
    if (job.sceneId) {
      const scene = await ctx.db.get(job.sceneId);
      const problem = job.problemId ? await ctx.db.get(job.problemId) : null;
      if (!scene || !problem || !problem.consent || problem.revision !== job.revision || scene.jobId !== job._id) return null;
      if ((await eligibleAnalysis(ctx, problem))?._id !== scene.analysisId) return null;
      const photo = await ctx.db.get(scene.photoId);
      if (!photo?.storageId || photo.state !== "ready" || photo.problemId !== problem._id) return null;
      return { job, photo, prompt: null };
    }
    if (!job.assemblyId) return null;
    const assembly = await ctx.db.get(job.assemblyId);
    return assembly?.status === "draft" ? { job, photo: null, prompt: assembly.prompt } : null;
  },
});
export const setTask = internalMutation({
  args: { jobId: v.id("jobs"), providerTaskId: v.string() },
  handler: async (ctx, args) => {
    const job = await current(ctx, args.jobId);
    if (!job || job.state !== "running" || job.kind !== "tripo" || job.providerTaskId) return false;
    await ctx.db.patch(job._id, { providerTaskId: args.providerTaskId });
    await ctx.scheduler.runAfter(15_000, internal.tripo.poll, { jobId: job._id, attempt: 0 });
    return true;
  },
});
export const generate = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    if (!await ctx.runMutation(internal.jobs.claim, { jobId })) return;
    const input = await ctx.runQuery(internal.tripo.data, { jobId });
    if (!input) return;
    const key = process.env.TRIPO_API_KEY;
    if (!key || !process.env.TRIPO_MODEL_VERSION) {
      await ctx.runMutation(internal.jobs.fail, { jobId, message: "Tripo is not configured." }); return;
    }
    try {
      let fileToken: string | undefined;
      if (input.photo) {
        const type = input.photo.mime === "image/jpeg" ? "jpg" : input.photo.mime === "image/png" ? "png" : input.photo.mime === "image/webp" ? "webp" : null;
        if (!type || !input.photo.storageId) throw new Error("Unsupported source photo");
        const blob = await ctx.storage.get(input.photo.storageId);
        if (!blob || blob.size > 10 * 1024 * 1024) throw new Error("Source photo is unavailable or too large");
        const form = new FormData();
        form.set("file", blob, `repair.${type}`);
        const upload = await fetch(`${imageApi}/files`, {
          method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
          signal: AbortSignal.timeout(45_000),
        });
        if (!upload.ok) throw new Error("Tripo image upload rejected");
        const result = imageUploaded.parse(await upload.json());
        fileToken = result.data.file_token;
      }
      // Recheck consent and revision after upload, before the billable request.
      if (!await ctx.runQuery(internal.tripo.data, { jobId })) return;
      const response = await fetch(input.job.tripoApiVersion === "v3" ? `${imageApi}/generation/image-to-model` : base, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify(fileToken ? {
          input: fileToken, model: process.env.TRIPO_MODEL_VERSION,
          face_limit: 100_000, texture: true, pbr: true,
        } : {
          type: "text_to_model", prompt: input.prompt, model_version: process.env.TRIPO_MODEL_VERSION,
        }),
      });
      if (!response.ok) throw new Error("Tripo request rejected");
      const result = taskCreated.parse(await response.json());
      await ctx.runMutation(internal.tripo.setTask, { jobId, providerTaskId: result.data.task_id });
    } catch {
      await ctx.runMutation(internal.jobs.fail, {
        jobId, message: "Tripo submission failed or its outcome is unknown. Check the provider dashboard before requesting another paid generation; this task will not be submitted again automatically.",
      });
    }
  },
});
export const pollClaim = internalMutation({
  args: { jobId: v.id("jobs"), attempt: v.number() },
  handler: async (ctx, args) => {
    const job = await current(ctx, args.jobId);
    if (!job || job.kind !== "tripo" || !job.providerTaskId || job.attempts !== args.attempt + 1) return false;
    await ctx.db.patch(job._id, { attempts: job.attempts + 1 });
    return true;
  },
});
export const poll = internalAction({
  args: { jobId: v.id("jobs"), attempt: v.number() },
  handler: async (ctx, { jobId, attempt }) => {
    if (!await ctx.runMutation(internal.tripo.pollClaim, { jobId, attempt })) return;
    const input = await ctx.runQuery(internal.tripo.data, { jobId });
    if (!input?.job.providerTaskId) return;
    const key = process.env.TRIPO_API_KEY;
    if (!key) { await ctx.runMutation(internal.jobs.fail, { jobId, message: "Tripo credentials are missing." }); return; }
    let storageId: Id<"_storage"> | undefined;
    let retryable = true;
    try {
      const taskBase = input.job.tripoApiVersion === "v3" ? `${imageApi}/tasks` : base;
      const response = await fetch(`${taskBase}/${encodeURIComponent(input.job.providerTaskId)}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        retryable = response.status === 429 || response.status >= 500;
        throw new Error("Polling failed");
      }
      retryable = false;
      const result = taskStatus.parse(await response.json());
      if (result.data.task_id !== input.job.providerTaskId) throw new Error("Task identity mismatch");
      if (["failed", "cancelled", "banned", "expired", "unknown"].includes(result.data.status)) {
        await ctx.runMutation(internal.jobs.fail, { jobId, message: "Tripo could not complete this task. Review its provider dashboard." }); return;
      }
      if (result.data.status !== "success") {
        if (attempt >= 39) throw new Error("Polling limit exceeded");
        await ctx.scheduler.runAfter(15_000, internal.tripo.poll, { jobId, attempt: attempt + 1 }); return;
      }
      const output = input.job.tripoApiVersion === "v3" ? result.data.output?.model_url : result.data.output?.pbr_model ?? result.data.output?.model;
      if (!output) throw new Error("No GLB output");
      const url = new URL(typeof output === "string" ? output : "url" in output ? output.url : output.model);
      const hosts = (process.env.TRIPO_ASSET_HOSTS ?? "tripo3d.ai,tripo3d.com").split(",").map(s => s.trim()).filter(Boolean);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) throw new Error("Unapproved asset host");
      retryable = true;
      const download = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(45_000) });
      if (!download.ok) {
        retryable = download.status === 429 || download.status >= 500;
        throw new Error("Asset download failed");
      }
      retryable = false;
      const bytes = await boundedDownload(download, 10 * 1024 * 1024);
      const metadata = inspectGlb(bytes);
      storageId = await ctx.storage.store(new Blob([Uint8Array.from(bytes)], { type: "model/gltf-binary" }));
      const attached = await ctx.runMutation(internal.tripo.ingest, { jobId, storageId, ...metadata });
      if (!attached) await ctx.runMutation(internal.cleanup.discardUnreferenced, { storageId });
    } catch {
      if (storageId) await ctx.runMutation(internal.cleanup.discardUnreferenced, { storageId });
      if (retryable && attempt < 39 && await ctx.runQuery(internal.tripo.data, { jobId })) {
        // Polling is read-only and can safely retry. Submission is never retried.
        await ctx.scheduler.runAfter(20_000, internal.tripo.poll, { jobId, attempt: attempt + 1 });
      } else await ctx.runMutation(internal.jobs.fail, { jobId, message: "Tripo polling or GLB validation failed. Check the task and prepare a valid, self-contained asset." });
    }
  },
});
export const ingest = internalMutation({
  args: { jobId: v.id("jobs"), storageId: v.id("_storage"), nodeNames: v.array(v.string()), triangleCount: v.number(), mappingReady: v.boolean() },
  handler: async (ctx, args) => {
    const job = await current(ctx, args.jobId);
    if (!job || job.state !== "running" || job.kind !== "tripo" || !job.providerTaskId) return false;
    if (job.sceneId && job.problemId) {
      const scene = await ctx.db.get(job.sceneId);
      const problem = await ctx.db.get(job.problemId);
      if (!scene || scene.storageId || !problem || (await eligibleAnalysis(ctx, problem))?._id !== scene.analysisId) return false;
      await ctx.db.patch(scene._id, { storageId: args.storageId, triangleCount: args.triangleCount });
      await ctx.db.patch(job._id, { state: "succeeded" });
      return true;
    }
    if (!job.assemblyId) return false;
    const asset = await ctx.db.get(job.assemblyId);
    if (!asset || asset.status !== "draft" || asset.storageId) return false;
    await ctx.db.patch(asset._id, {
      storageId: args.storageId, nodeNames: args.nodeNames, triangleCount: args.triangleCount,
      mappingReady: args.mappingReady, generatedByTripo: true,
    });
    await ctx.db.patch(job._id, { state: "succeeded" });
    return true;
  },
});
export const reserveCleanedUpload = mutation({
  args: { assemblyId: v.id("assemblies") },
  handler: async (ctx, args) => {
    const user = await admin(ctx);
    const asset = await ctx.db.get(args.assemblyId);
    if (!asset || asset.status !== "draft" || !asset.generatedByTripo) throw new ConvexError("Choose a draft generated assembly; reviewed assets are immutable.");
    await quota(ctx, `asset-upload:${user.subject}`, 10);
    const reservationId = await ctx.db.insert("assetUploads", { owner: user.subject, assemblyId: asset._id, expiresAt: Date.now() + 600_000 });
    await ctx.scheduler.runAfter(600_000, internal.tripo.expireUpload, { reservationId });
    return { reservationId, uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});
export const uploadData = internalMutation({
  args: { reservationId: v.id("assetUploads"), owner: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    const stored = await ctx.db.system.get(args.storageId);
    if (!reservation || reservation.owner !== args.owner || reservation.expiresAt <= Date.now() || !stored || stored._creationTime < reservation._creationTime) throw new ConvexError("Invalid or expired asset upload.");
    const asset = await ctx.db.get(reservation.assemblyId);
    if (!asset || asset.status !== "draft") throw new ConvexError("Assembly is no longer editable.");
    if (reservation.storageId && reservation.storageId !== args.storageId) throw new ConvexError("Reservation already used.");
    const media = await ctx.db.query("media").filter(q => q.eq(q.field("storageId"), args.storageId)).first();
    const existing = await ctx.db.query("assemblies").filter(q => q.eq(q.field("storageId"), args.storageId)).first();
    if (media || existing) throw new ConvexError("File is already in use.");
    await ctx.db.patch(reservation._id, { storageId: args.storageId });
    return reservation;
  },
});
export const finalizeCleanedUpload = action({
  args: { reservationId: v.id("assetUploads"), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<void> => {
    const user = await admin(ctx);
    await ctx.runMutation(internal.tripo.uploadData, { ...args, owner: user.subject });
    try {
      const blob = await ctx.storage.get(args.storageId);
      if (!blob || blob.size > 10 * 1024 * 1024) throw new ConvexError("GLB must be no larger than 10 MB.");
      const metadata = inspectGlb(new Uint8Array(await blob.arrayBuffer()));
      if (!metadata.mappingReady) throw new ConvexError("Name every mesh node uniquely before uploading.");
      const attached = await ctx.runMutation(internal.tripo.attachCleaned, { ...args, ...metadata, owner: user.subject });
      if (!attached) throw new ConvexError("Asset changed while uploading.");
    } catch (error) {
      await ctx.runMutation(internal.tripo.discardUpload, { reservationId: args.reservationId });
      await ctx.runMutation(internal.cleanup.discardUnreferenced, { storageId: args.storageId });
      throw new ConvexError(error instanceof Error ? error.message.slice(0, 250) : "Invalid GLB.");
    }
  },
});
export const attachCleaned = internalMutation({
  args: { reservationId: v.id("assetUploads"), storageId: v.id("_storage"), nodeNames: v.array(v.string()), triangleCount: v.number(), mappingReady: v.boolean(), owner: v.string() },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.owner !== args.owner || reservation.expiresAt <= Date.now() || reservation.storageId !== args.storageId) return false;
    const asset = await ctx.db.get(reservation.assemblyId);
    if (!asset || asset.status !== "draft") return false;
    if (asset.storageId) await ctx.storage.delete(asset.storageId);
    await ctx.db.patch(asset._id, { storageId: args.storageId, nodeNames: args.nodeNames, triangleCount: args.triangleCount, mappingReady: args.mappingReady, parts: [] });
    await ctx.db.delete(reservation._id);
    return true;
  },
});
export const expireUpload = internalMutation({
  args: { reservationId: v.id("assetUploads") },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (reservation && reservation.expiresAt <= Date.now()) {
      await ctx.db.delete(reservation._id);
      if (reservation.storageId) await ctx.scheduler.runAfter(0, internal.cleanup.discardUnreferenced, { storageId: reservation.storageId });
    }
  },
});
export const discardUpload = internalMutation({
  args: { reservationId: v.id("assetUploads") },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (reservation) await ctx.db.delete(reservation._id);
  },
});
