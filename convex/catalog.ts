import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import type { AssemblyPart } from "../src/lib/domain";

export async function counts(ctx: QueryCtx, guideVersionId: Id<"guideVersions">) {
  const feedback = await ctx.db.query("feedback").withIndex("by_guide", q => q.eq("guideVersionId", guideVersionId)).collect();
  return {
    worked: feedback.filter(f => f.outcome === "worked").length,
    partly: feedback.filter(f => f.outcome === "partly").length,
    not_worked: feedback.filter(f => f.outcome === "not_worked").length,
    total: feedback.length,
  };
}
export const list = query({
  args: { category: v.optional(v.string()), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const entries = await ctx.db.query("catalogProblems").collect();
    const result = [];
    for (const entry of entries) {
      if (!entry.publishedVersionId) continue;
      const version = await ctx.db.get(entry.publishedVersionId);
      if (!version || version.guide.status !== "published" || version.withdrawn) continue;
      if (args.category && version.guide.category !== args.category) continue;
      const search = args.search?.trim().toLowerCase();
      if (search && ![version.guide.title, version.guide.summary, ...version.guide.symptoms].join(" ").toLowerCase().includes(search)) continue;
      result.push({ ...version.guide, _id: version._id, counts: await counts(ctx, version._id) });
    }
    return result;
  },
});
export const detail = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const entry = await ctx.db.query("catalogProblems").withIndex("by_slug", q => q.eq("slug", slug)).unique();
    if (!entry?.publishedVersionId) return null;
    const version = await ctx.db.get(entry.publishedVersionId);
    return publicVersion(ctx, version);
  },
});
async function publicVersion(ctx: QueryCtx, version: Doc<"guideVersions"> | null) {
  if (!version || version.guide.status !== "published" || version.withdrawn) return null;
  const asset = version.assemblyId ? await ctx.db.get(version.assemblyId) : null;
  const url = asset?.status === "reviewed" && asset.storageId ? await ctx.storage.getUrl(asset.storageId) : null;
  const parts: AssemblyPart[] = asset?.parts.map(p => ({
    ...p, explodeOffset: [p.explodeOffset[0], p.explodeOffset[1], p.explodeOffset[2]],
  })) ?? [];
  return {
    guide: { ...version.guide, _id: version._id },
    assembly: asset && url ? { url, parts, reviewed: true as const } : null,
    counts: await counts(ctx, version._id),
  };
}
export const version = query({
  args: { guideVersionId: v.id("guideVersions") },
  handler: async (ctx, args) => publicVersion(ctx, await ctx.db.get(args.guideVersionId)),
});
