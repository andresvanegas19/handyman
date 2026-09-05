import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import { currentRun } from "./repairPipeline";
import { boundedDownload, inspectGlb } from "./glb";

const base = "https://openapi.tripo3d.ai/v3";
const argsValidator = { runId: v.id("repairRuns"), stageId: v.id("repairStages") };
const created = z.object({ code: z.literal(0), data: z.object({ task_id: z.string().min(1).max(200) }) });
const uploaded = z.object({ code: z.literal(0), data: z.object({ file_token: z.string().min(1).max(1000) }) });
const status = z.object({
  code: z.literal(0), data: z.object({
    task_id: z.string(), status: z.enum(["queued", "running", "success", "failed", "cancelled", "banned", "expired", "unknown"]),
    output: z.object({ model_url: z.string().optional() }).optional(),
  }),
});
export function trustedModelUrl(raw: string) {
  const url = new URL(raw);
  const allowed = ["cdn.tripo3d.ai", ...(process.env.TRIPO_ASSET_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean)];
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed.includes(url.hostname) ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(url.hostname)) throw new Error("Untrusted Tripo asset URL.");
  return url.href;
}
export const setTask = internalMutation({
  args: { ...argsValidator, providerTaskId: v.string() },
  handler: async (ctx, args) => {
    const input = await currentRun(ctx, args.runId);
    const stage = await ctx.db.get(args.stageId);
    if (!stage || stage.runId !== args.runId || stage.providerTaskId ||
        !stage.paidSubmission || !["generating_model", "segmenting"].includes(stage.phase)) return false;
    await ctx.db.patch(stage._id, { providerTaskId: args.providerTaskId, ambiguous: false });
    await ctx.db.patch(args.runId, stage.phase === "generating_model" ? { generationTaskId: args.providerTaskId } : { segmentationTaskId: args.providerTaskId });
    const run = await ctx.db.get(args.runId);
    const problem = run ? await ctx.db.get(run.problemId) : null;
    if (run?.phase === "failed" && run.activeStageId === stage._id && problem?.consent &&
        problem.revision === run.revision && problem.activeRepairRunId === run._id) {
      await ctx.db.patch(run._id, { retryable: true, message: "The provider acknowledged the existing task. Retry checks it without another paid submission." });
    }
    if (!input || stage.state !== "running" || input.run.activeStageId !== stage._id) return false;
    await ctx.scheduler.runAfter(15_000, internal.repairModel.poll, { runId: args.runId, stageId: args.stageId, attempt: 0 });
    return true;
  },
});
export const submit = internalAction({
  args: argsValidator,
  handler: async (ctx, args): Promise<void> => {
    if (!await ctx.runMutation(internal.repairPipeline.claim, args)) return;
    const input = await ctx.runQuery(internal.repairPipeline.input, args);
    if (!input) return;
    let submitted = false;
    try {
      const key = process.env.TRIPO_API_KEY;
      if (!key || !process.env.TRIPO_MODEL_VERSION) throw new Error("Tripo is not configured.");
      let source: string;
      if (input.run.phase === "segmenting") {
        if (!input.run.generationTaskId) throw new Error("Generation task identity is missing.");
        source = input.run.generationTaskId;
      } else {
        const blob = await ctx.storage.get(input.photo.storageId!);
        const type = input.photo.mime === "image/jpeg" ? "jpg" : input.photo.mime === "image/png" ? "png" : input.photo.mime === "image/webp" ? "webp" : null;
        if (!blob || blob.size > 10 * 1024 * 1024 || !type) throw new Error("Invalid source photo.");
        const body = new FormData();
        body.set("file", blob, `repair.${type}`);
        const response = await fetch(`${base}/files`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(45_000) });
        if (!response.ok) throw new Error("Photo upload failed.");
        source = uploaded.parse(await response.json()).data.file_token;
      }
      // The durable reservation rechecks consent/revision immediately before the billable call.
      if (!await ctx.runMutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" })) return;
      submitted = true;
      const segmentation = input.run.phase === "segmenting";
      const response = await fetch(`${base}/${segmentation ? "mesh/segment" : "generation/image-to-model"}`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify(segmentation ? {
          input: source, model: "v2.0-20260430", segmentation_granularity: "detailed", split_by_connectivity: true,
        } : { input: source, model: process.env.TRIPO_MODEL_VERSION, face_limit: 100_000, texture: true, pbr: true }),
      });
      if (!response.ok) throw new Error("Paid request was not acknowledged.");
      const task = created.parse(await response.json());
      await ctx.runMutation(internal.repairModel.setTask, { ...args, providerTaskId: task.data.task_id });
    } catch {
      await ctx.runMutation(internal.repairPipeline.fail, {
        ...args, retryable: !submitted, ambiguous: submitted,
        message: submitted ? "The paid Tripo submission outcome is unknown. Check its dashboard; this request will not be replayed." : "Tripo configuration or photo upload failed. Completed stages are retained.",
      });
    }
  },
});
export const pollClaim = internalMutation({
  args: { ...argsValidator, attempt: v.number() },
  handler: async (ctx, args) => {
    const input = await currentRun(ctx, args.runId);
    const stage = await ctx.db.get(args.stageId);
    if (!input || !stage || input.run.activeStageId !== stage._id || stage.state !== "running" ||
        !stage.providerTaskId || stage.deadline <= Date.now() || stage.pollAttempt !== args.attempt) return null;
    await ctx.db.patch(stage._id, { pollAttempt: args.attempt + 1 });
    return { ...input, stage };
  },
});
export const schedulePoll = internalMutation({
  args: { ...argsValidator, attempt: v.number() },
  handler: async (ctx, args) => {
    const input = await currentRun(ctx, args.runId);
    const stage = await ctx.db.get(args.stageId);
    if (!input || !stage || stage.state !== "running" || input.run.activeStageId !== stage._id || stage.pollAttempt !== args.attempt) return;
    await ctx.scheduler.runAfter(15_000, internal.repairModel.poll, args);
  },
});
export const completeModel = internalMutation({
  args: {
    ...argsValidator, storageId: v.id("_storage"), nodeNames: v.array(v.string()), triangleCount: v.number(), hash: v.string(),
  },
  handler: async (ctx, args) => {
    const input = await currentRun(ctx, args.runId);
    const stage = await ctx.db.get(args.stageId);
    if (!input || !stage || stage.state !== "running" || input.run.activeStageId !== stage._id ||
        !stage.providerTaskId || !["generating_model", "segmenting"].includes(stage.phase)) return false;
    const priorStorage = input.run.modelStorageId;
    await ctx.db.patch(args.runId, {
      modelStorageId: args.storageId, nodeNames: args.nodeNames, triangleCount: args.triangleCount, modelHash: args.hash,
    });
    await ctx.db.patch(stage._id, { state: "succeeded" });
    const phase = stage.phase === "generating_model" ? "segmenting" as const : "mapping" as const;
    const deadline = Date.now() + (phase === "segmenting" ? 900_000 : 180_000);
    const stageId = await ctx.db.insert("repairStages", {
      runId: args.runId, phase, attempt: 1, state: "queued", deadline, paidSubmission: false, ambiguous: false, pollAttempt: 0,
    });
    await ctx.db.patch(args.runId, { phase, activeStageId: stageId, updatedAt: Date.now(), message: phase === "segmenting" ? "Separating visible components." : "Matching steps to visible components." });
    await ctx.scheduler.runAfter(0, phase === "segmenting" ? internal.repairModel.submit : internal.repairPipeline.work, { runId: args.runId, stageId });
    await ctx.scheduler.runAfter(deadline - Date.now(), internal.repairPipeline.expire, { runId: args.runId, stageId });
    if (priorStorage && priorStorage !== args.storageId) await ctx.scheduler.runAfter(0, internal.cleanup.discardUnreferenced, { storageId: priorStorage });
    return true;
  },
});
export const poll = internalAction({
  args: { ...argsValidator, attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const input = await ctx.runMutation(internal.repairModel.pollClaim, args);
    if (!input?.stage.providerTaskId) return;
    let storageId: Id<"_storage"> | undefined;
    try {
      const response = await fetch(`${base}/tasks/${encodeURIComponent(input.stage.providerTaskId)}`, {
        headers: { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` }, signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && args.attempt < 49) {
          await ctx.runMutation(internal.repairModel.schedulePoll, { ...args, attempt: args.attempt + 1 }); return;
        }
        throw new Error("Task polling failed.");
      }
      const result = status.parse(await response.json()).data;
      if (result.task_id !== input.stage.providerTaskId) throw new Error("Task identity mismatch.");
      if (result.status === "queued" || result.status === "running") {
        if (args.attempt >= 49) throw new Error("Task polling limit exceeded.");
        await ctx.runMutation(internal.repairModel.schedulePoll, { ...args, attempt: args.attempt + 1 }); return;
      }
      if (result.status !== "success" || !result.output?.model_url) throw new Error("The provider could not produce a model.");
      const download = await fetch(trustedModelUrl(result.output.model_url), { redirect: "error", signal: AbortSignal.timeout(45_000) });
      const bytes = await boundedDownload(download, 10 * 1024 * 1024);
      const inspected = inspectGlb(bytes);
      if (input.run.phase === "segmenting" && !inspected.mappingReady) throw new Error("The segmented model does not contain distinct named parts.");
      if (!await ctx.runQuery(internal.repairPipeline.input, { runId: args.runId, stageId: args.stageId })) return;
      const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const hash = [...hashBytes].map(n => n.toString(16).padStart(2, "0")).join("");
      storageId = await ctx.storage.store(new Blob([bytes], { type: "model/gltf-binary" }));
      if (!await ctx.runMutation(internal.repairModel.completeModel, {
        runId: args.runId, stageId: args.stageId, storageId, nodeNames: inspected.nodeNames, triangleCount: inspected.triangleCount, hash,
      })) await ctx.runMutation(internal.cleanup.discardUnreferenced, { storageId });
    } catch {
      if (storageId) await ctx.runMutation(internal.cleanup.discardUnreferenced, { storageId });
      await ctx.runMutation(internal.repairPipeline.fail, {
        runId: args.runId, stageId: args.stageId, retryable: true, ambiguous: false,
        message: "Tripo output is unavailable or invalid. Retry checks the same task without another paid submission.",
      });
    }
  },
});
