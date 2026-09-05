import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { cancelProblemJobs, identity, ownProblem, quota } from "./lib";
import { inspectMedia } from "./mediaValidation";

export const reserve = mutation({
  args: { problemId: v.id("problems"), kind: v.union(v.literal("photo"), v.literal("audio")) },
  handler: async (ctx, args) => {
    const problem = await ownProblem(ctx, args.problemId);
    if (!problem.consent) throw new ConvexError("Consent is required before uploading media.");
    await quota(ctx, `upload:${problem.owner}`, 30);
    const current = await ctx.db.query("media").withIndex("by_problem", q => q.eq("problemId", args.problemId)).collect();
    if (current.filter(m => m.kind === args.kind).length >= (args.kind === "photo" ? 3 : 1)) throw new ConvexError("Maximum three photos and one audio clip per problem.");
    const reservationId = await ctx.db.insert("media", {
      ...args, owner: problem.owner, state: "reserved", expiresAt: Date.now() + 600_000,
    });
    await ctx.scheduler.runAfter(600_000, internal.uploads.cleanup, { reservationId });
    return { reservationId, uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});
export const claim = internalMutation({
  args: { reservationId: v.id("media"), storageId: v.id("_storage"), owner: v.string() },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.reservationId);
    if (!media || media.owner !== args.owner || media.state !== "reserved" || media.expiresAt <= Date.now()) throw new ConvexError("Upload reservation expired.");
    const problem = await ctx.db.get(media.problemId);
    if (!problem || !problem.consent || problem.owner !== args.owner) throw new ConvexError("Problem not available.");
    if (media.storageId && media.storageId !== args.storageId) throw new ConvexError("Upload reservation already used.");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata._creationTime < media._creationTime) throw new ConvexError("Invalid uploaded file.");
    const existing = await ctx.db.query("media").filter(q => q.eq(q.field("storageId"), args.storageId)).first();
    const asset = await ctx.db.query("assemblies").filter(q => q.eq(q.field("storageId"), args.storageId)).first();
    if ((existing && existing._id !== media._id) || asset) throw new ConvexError("This file is already attached.");
    await ctx.db.patch(media._id, { storageId: args.storageId });
    return media;
  },
});
export const finalize = action({
  args: { reservationId: v.id("media"), storageId: v.id("_storage"), durationSeconds: v.optional(v.number()) },
  handler: async (ctx, args): Promise<void> => {
    const user = await identity(ctx);
    const media = await ctx.runMutation(internal.uploads.claim, { reservationId: args.reservationId, storageId: args.storageId, owner: user.subject });
    try {
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) throw new ConvexError("Uploaded file was not found.");
      if (blob.size > (media.kind === "photo" ? 10 : 15) * 1024 * 1024) throw new ConvexError("File exceeds the upload size limit.");
      const verified = inspectMedia(new Uint8Array(await blob.arrayBuffer()), media.kind);
      await ctx.runMutation(internal.uploads.attach, { reservationId: media._id, storageId: args.storageId, ...verified, bytes: blob.size });
    } catch (error) {
      await ctx.runMutation(internal.uploads.discard, { reservationId: media._id });
      throw error;
    }
  },
});
export const attach = internalMutation({
  args: { reservationId: v.id("media"), storageId: v.id("_storage"), mime: v.string(), bytes: v.number(), durationSeconds: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.reservationId);
    const problem = media ? await ctx.db.get(media.problemId) : null;
    if (!media || !problem || !problem.consent || media.state !== "reserved" || media.storageId !== args.storageId || media.expiresAt <= Date.now()) {
      if (!media) await ctx.storage.delete(args.storageId);
      throw new ConvexError("Upload expired or problem changed.");
    }
    await ctx.db.patch(media._id, { state: "ready", mime: args.mime, bytes: args.bytes, durationSeconds: args.durationSeconds });
    await cancelProblemJobs(ctx, problem._id);
    await ctx.db.patch(problem._id, {
      revision: problem.revision + 1, state: "draft", activeJobId: undefined, failure: undefined,
      ...(media.kind === "audio" ? { transcript: "", transcriptConfirmed: false } : {}), updatedAt: Date.now(),
    });
  },
});
export const discard = internalMutation({
  args: { reservationId: v.id("media") },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.reservationId);
    if (!media || media.state !== "reserved") return;
    if (media.storageId) await ctx.storage.delete(media.storageId);
    await ctx.db.delete(media._id);
  },
});
export const cleanup = internalMutation({
  args: { reservationId: v.id("media") },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.reservationId);
    if (media?.state === "reserved" && media.expiresAt <= Date.now()) {
      if (media.storageId) await ctx.storage.delete(media.storageId);
      await ctx.db.delete(media._id);
    }
  },
});
export const remove = mutation({
  args: { mediaId: v.id("media") },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.mediaId);
    if (!media) throw new ConvexError("Media not found.");
    const problem = await ownProblem(ctx, media.problemId);
    if (media.storageId) await ctx.storage.delete(media.storageId);
    await ctx.db.delete(media._id);
    await cancelProblemJobs(ctx, problem._id);
    await ctx.db.patch(problem._id, {
      revision: problem.revision + 1, state: "draft", activeJobId: undefined,
      ...(media.kind === "audio" ? { transcript: "", transcriptConfirmed: false } : {}),
    });
  },
});
export const privateFile = internalQuery({
  args: { mediaId: v.id("media"), owner: v.string() },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.mediaId);
    if (!media || media.owner !== args.owner || media.state !== "ready" || !media.storageId) return null;
    if (!await ctx.db.get(media.problemId)) return null;
    return { storageId: media.storageId, mime: media.mime };
  },
});
