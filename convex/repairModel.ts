import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import { currentRun } from "./repairPipeline";
import { boundedDownload, inspectGlb } from "./glb";
import { repairErrorCode, repairLog } from "../src/lib/repair-log";

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
    repairLog("tripo.task.acknowledged", { runId: args.runId, stageId: args.stageId, phase: stage.phase, requestId: args.providerTaskId });
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
    if (!await ctx.runMutation(internal.repairPipeline.claim, args)) {
      repairLog("tripo.submission.skipped", { ...args, code: "stale_or_already_claimed" });
      return;
    }
    const input = await ctx.runQuery(internal.repairPipeline.input, args);
    if (!input) return;
    let submitted = false;
    let operation = "configuration";
    const startedAt = Date.now();
    try {
      const key = process.env.TRIPO_API_KEY;
      if (!key || !process.env.TRIPO_MODEL_VERSION) throw new Error("Tripo is not configured.");
      let source: string;
      if (input.run.phase === "segmenting") {
        if (!input.run.generationTaskId) throw new Error("Generation task identity is missing.");
        source = input.run.generationTaskId;
      } else {
        operation = "photo_read";
        const blob = await ctx.storage.get(input.photo.storageId!);
        const type = input.photo.mime === "image/jpeg" ? "jpg" : input.photo.mime === "image/png" ? "png" : input.photo.mime === "image/webp" ? "webp" : null;
        if (!blob || blob.size > 10 * 1024 * 1024 || !type) throw new Error("Invalid source photo.");
        const body = new FormData();
        body.set("file", blob, `repair.${type}`);
        operation = "photo_upload";
        repairLog("tripo.photo.upload.started", { ...args, bytes: blob.size });
        const response = await fetch(`${base}/files`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(45_000) });
        repairLog("tripo.photo.upload.response", { ...args, httpStatus: response.status }, response.ok ? "info" : "error");
        if (!response.ok) throw new Error(`Provider request rejected (HTTP ${response.status}).`);
        source = uploaded.parse(await response.json()).data.file_token;
      }
      // The durable reservation rechecks consent/revision immediately before the billable call.
      operation = "budget_reservation";
      if (!await ctx.runMutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" })) {
        repairLog("tripo.submission.skipped", { ...args, phase: input.run.phase, code: "provider_reservation_rejected" }, "warn");
        return;
      }
      submitted = true;
      const segmentation = input.run.phase === "segmenting";
      operation = segmentation ? "segmentation_submission" : "generation_submission";
      repairLog("tripo.submission.started", { ...args, phase: input.run.phase });
      const response = await fetch(`${base}/${segmentation ? "mesh/segment" : "generation/image-to-model"}`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify(segmentation ? {
          input: source, model: "v2.0-20260430", segmentation_granularity: "detailed", split_by_connectivity: true,
        } : { input: source, model: process.env.TRIPO_MODEL_VERSION, face_limit: 100_000, texture: true, pbr: true }),
      });
      repairLog("tripo.submission.response", { ...args, phase: input.run.phase, httpStatus: response.status }, response.ok ? "info" : "error");
      if (!response.ok) throw new Error(`Provider request rejected (HTTP ${response.status}).`);
      const task = created.parse(await response.json());
      operation = "task_persistence";
      await ctx.runMutation(internal.repairModel.setTask, { ...args, providerTaskId: task.data.task_id });
    } catch (error) {
      repairLog("tripo.submission.failed", { ...args, phase: input.run.phase, operation, elapsedMs: Date.now() - startedAt, code: repairErrorCode(error), ambiguous: submitted }, "error");
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
    repairLog("tripo.poll.scheduled", { ...args, phase: input.run.phase, requestId: stage.providerTaskId });
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
        stage.runId !== args.runId || stage.phase !== input.run.phase || stage.deadline <= Date.now() ||
        !stage.providerTaskId || !["generating_model", "segmenting"].includes(stage.phase)) return false;
    const priorStorage = input.run.modelStorageId;
    await ctx.db.patch(args.runId, {
      modelStorageId: args.storageId, nodeNames: args.nodeNames, triangleCount: args.triangleCount, modelHash: args.hash,
    });
    await ctx.db.patch(stage._id, { state: "succeeded" });
    const phase = input.run.intent === "preview" ? "validating" as const :
      stage.phase === "generating_model" ? "segmenting" as const : "mapping" as const;
    const deadline = Date.now() + (phase === "segmenting" ? 900_000 : 180_000);
    const stageId = await ctx.db.insert("repairStages", {
      runId: args.runId, phase, attempt: 1, state: "queued", deadline, paidSubmission: false, ambiguous: false, pollAttempt: 0,
    });
    await ctx.db.patch(args.runId, { phase, activeStageId: stageId, updatedAt: Date.now(), message: phase === "validating" ? "Checking the approximate visual reference. It is not a repair guide." : phase === "segmenting" ? "Separating visible components." : "Matching steps to visible components." });
    await ctx.scheduler.runAfter(0, phase === "segmenting" ? internal.repairModel.submit : internal.repairPipeline.work, { runId: args.runId, stageId });
    await ctx.scheduler.runAfter(deadline - Date.now(), internal.repairPipeline.expire, { runId: args.runId, stageId });
    repairLog("stage.completed", { runId: args.runId, stageId: args.stageId, phase: stage.phase, nextPhase: phase, count: args.nodeNames.length });
    repairLog("stage.queued", { runId: args.runId, stageId, phase, attempt: 1 });
    if (priorStorage && priorStorage !== args.storageId) await ctx.scheduler.runAfter(0, internal.cleanup.discardUnreferenced, { storageId: priorStorage });
    return true;
  },
});
export const poll = internalAction({
  args: { ...argsValidator, attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const input = await ctx.runMutation(internal.repairModel.pollClaim, args);
    if (!input?.stage.providerTaskId) {
      repairLog("tripo.poll.skipped", { ...args, code: "stale_or_already_claimed" });
      return;
    }
    let storageId: Id<"_storage"> | undefined;
    let operation = "task_poll";
    const startedAt = Date.now();
    try {
      repairLog("tripo.poll.started", { ...args, phase: input.run.phase, requestId: input.stage.providerTaskId });
      const response = await fetch(`${base}/tasks/${encodeURIComponent(input.stage.providerTaskId)}`, {
        headers: { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` }, signal: AbortSignal.timeout(20_000),
      });
      repairLog("tripo.poll.response", { ...args, httpStatus: response.status }, response.ok ? "info" : "warn");
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && args.attempt < 49) {
          await ctx.runMutation(internal.repairModel.schedulePoll, { ...args, attempt: args.attempt + 1 }); return;
        }
        throw new Error(`Provider request rejected (HTTP ${response.status}).`);
      }
      const result = status.parse(await response.json()).data;
      if (result.task_id !== input.stage.providerTaskId) throw new Error("Task identity mismatch.");
      repairLog("tripo.task.status", { ...args, phase: input.run.phase, status: result.status },
        ["queued", "running", "success"].includes(result.status) ? "info" : "error");
      if (result.status === "queued" || result.status === "running") {
        if (args.attempt >= 49) throw new Error("Task polling limit exceeded.");
        await ctx.runMutation(internal.repairModel.schedulePoll, { ...args, attempt: args.attempt + 1 }); return;
      }
      if (result.status !== "success" || !result.output?.model_url) throw new Error("The provider could not produce a model.");
      operation = "model_download";
      repairLog("tripo.model.download.started", { ...args });
      const download = await fetch(trustedModelUrl(result.output.model_url), { redirect: "error", signal: AbortSignal.timeout(45_000) });
      repairLog("tripo.model.download.response", { ...args, httpStatus: download.status }, download.ok ? "info" : "error");
      if (!download.ok) throw new Error(`Provider request rejected (HTTP ${download.status}).`);
      const bytes = await boundedDownload(download, 10 * 1024 * 1024);
      operation = "model_validation";
      const inspected = inspectGlb(bytes);
      repairLog("tripo.model.inspected", { ...args, bytes: bytes.byteLength, count: inspected.nodeNames.length });
      if (input.run.phase === "segmenting" && !inspected.mappingReady) throw new Error("The segmented model does not contain distinct named parts.");
      if (!await ctx.runQuery(internal.repairPipeline.input, { runId: args.runId, stageId: args.stageId })) return;
      operation = "model_storage";
      const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const hash = [...hashBytes].map(n => n.toString(16).padStart(2, "0")).join("");
      storageId = await ctx.storage.store(new Blob([bytes], { type: "model/gltf-binary" }));
      if (!await ctx.runMutation(internal.repairModel.completeModel, {
        runId: args.runId, stageId: args.stageId, storageId, nodeNames: inspected.nodeNames, triangleCount: inspected.triangleCount, hash,
      })) await ctx.runMutation(internal.cleanup.discardUnreferenced, { storageId });
    } catch (error) {
      repairLog("tripo.poll.failed", { ...args, phase: input.run.phase, requestId: input.stage.providerTaskId, operation, elapsedMs: Date.now() - startedAt, code: repairErrorCode(error) }, "error");
      if (storageId) await ctx.runMutation(internal.cleanup.discardUnreferenced, { storageId });
      await ctx.runMutation(internal.repairPipeline.fail, {
        runId: args.runId, stageId: args.stageId, retryable: true, ambiguous: false,
        message: "Tripo output is unavailable or invalid. Retry checks the same task without another paid submission.",
      });
    }
  },
});
