import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";

async function referenced(ctx: MutationCtx, storageId: Id<"_storage">) {
  return Boolean(
    await ctx.db.query("media").filter(q => q.eq(q.field("storageId"), storageId)).first() ||
    await ctx.db.query("assemblies").filter(q => q.eq(q.field("storageId"), storageId)).first() ||
    await ctx.db.query("repairScenes").filter(q => q.eq(q.field("storageId"), storageId)).first() ||
    await ctx.db.query("repairSceneManifests").withIndex("by_storage", q => q.eq("storageId", storageId)).first() ||
    await ctx.db.query("repairRuns").filter(q => q.eq(q.field("modelStorageId"), storageId)).first() ||
    await ctx.db.query("assetUploads").filter(q => q.eq(q.field("storageId"), storageId)).first()
  );
}
export const discardUnreferenced = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    if (!await referenced(ctx, storageId)) await ctx.storage.delete(storageId);
  },
});
export const abandonedStorage = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.system.query("_storage").paginate({ cursor: args.cursor ?? null, numItems: 50 });
    for (const file of page.page) {
      // Native upload URLs can be abandoned before finalization. Allow active actions ample time.
      if (file._creationTime < Date.now() - 86_400_000 && !await referenced(ctx, file._id)) await ctx.storage.delete(file._id);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(1000, internal.cleanup.abandonedStorage, { cursor: page.continueCursor });
  },
});
