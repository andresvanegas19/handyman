import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { admin, allowedAdmin, bounded, guestOwner } from "./lib";
import { guide, part } from "./validators";
import type { Guide } from "../src/lib/domain";

export function validateGuide(value: Guide) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 100) throw new ConvexError("Use a short lowercase URL slug.");
  if (!Number.isInteger(value.version) || value.version < 1) throw new ConvexError("Version must be a positive integer.");
  bounded(value.title, 140, "Title", 3);
  bounded(value.summary, 1200, "Summary", 10);
  bounded(value.duration, 40, "Duration", 1);
  for (const [label, values] of Object.entries({ symptoms: value.symptoms, tools: value.tools, prerequisites: value.prerequisites, stopConditions: value.stopConditions })) {
    if (!values.length || values.length > 20) throw new ConvexError(`${label} requires 1–20 entries.`);
    for (const text of values) bounded(text, 800, label, 1);
  }
  if (!value.steps.length || value.steps.length > 20) throw new ConvexError("Include 1–20 steps.");
  for (const step of value.steps) {
    bounded(step.title, 140, "Step title", 1);
    bounded(step.description, 2000, "Step description", 10);
    if (step.partIds.length > 30 || step.partIds.some(id => !/^[a-z0-9-]{1,80}$/.test(id))) throw new ConvexError("Invalid step part IDs.");
    if (step.visual) {
      for (const [label, text] of Object.entries(step.visual)) bounded(text, 800, `Visual ${label}`, 1);
    }
  }
}
export const isAdmin = query({
  args: {}, handler: async ctx => {
    const user = await ctx.auth.getUserIdentity();
    return user ? allowedAdmin(guestOwner(user.subject)) : false;
  },
});
export const list = query({
  args: {}, handler: async ctx => { await admin(ctx); return await ctx.db.query("guideVersions").order("desc").collect(); },
});
export const assets = query({
  args: {}, handler: async ctx => {
    await admin(ctx);
    const rows = await ctx.db.query("assemblies").order("desc").collect();
    return await Promise.all(rows.map(async row => ({ ...row, url: row.storageId ? await ctx.storage.getUrl(row.storageId) : null })));
  },
});
export const jobs = query({
  args: {}, handler: async ctx => { await admin(ctx); return await ctx.db.query("jobs").filter(q => q.eq(q.field("kind"), "tripo")).order("desc").take(100); },
});
export const scheduledFailures = query({
  args: {},
  handler: async ctx => {
    await admin(ctx);
    const failures = await ctx.db.system.query("_scheduled_functions")
      .filter(q => q.eq(q.field("state.kind"), "failed")).order("desc").take(20);
    return failures.map(failure => ({
      _id: failure._id, functionName: failure.name, scheduledTime: failure.scheduledTime,
      message: "A scheduled backend task failed. Review the Convex deployment logs; expired problem jobs also receive an explicit timeout state.",
    }));
  },
});
export const saveDraft = mutation({
  args: { guide },
  handler: async (ctx, args) => {
    await admin(ctx);
    validateGuide(args.guide);
    if (args.guide.status !== "draft") throw new ConvexError("Only drafts can be edited. Use publication review separately.");
    let catalog = await ctx.db.query("catalogProblems").withIndex("by_slug", q => q.eq("slug", args.guide.slug)).unique();
    if (!catalog) {
      const id = await ctx.db.insert("catalogProblems", { slug: args.guide.slug });
      catalog = await ctx.db.get(id);
    }
    if (!catalog) throw new Error("Catalog creation failed");
    const versions = await ctx.db.query("guideVersions").withIndex("by_catalog", q => q.eq("catalogId", catalog._id)).collect();
    const existing = versions.find(g => g.guide.version === args.guide.version);
    if (existing?.guide.status === "published") throw new ConvexError("Published versions are immutable. Increase the version number.");
    if (existing) { await ctx.db.patch(existing._id, { guide: args.guide }); return existing._id; }
    return await ctx.db.insert("guideVersions", { catalogId: catalog._id, guide: args.guide });
  },
});
export const publish = mutation({
  args: { guideVersionId: v.id("guideVersions"), safetyReviewed: v.boolean(), rightsReviewed: v.boolean(), assemblyId: v.optional(v.id("assemblies")) },
  handler: async (ctx, args) => {
    const reviewer = await admin(ctx);
    const version = await ctx.db.get(args.guideVersionId);
    if (!version || version.guide.status !== "draft") throw new ConvexError("Choose an unpublished draft.");
    validateGuide(version.guide);
    if (!args.safetyReviewed || !args.rightsReviewed) throw new ConvexError("A qualified reviewer must confirm safety, applicability, and usage rights.");
    const text = JSON.stringify(version.guide);
    if (/unreviewed draft|draft review checkpoint|reviewer must|pending review/i.test(text)) throw new ConvexError("Replace draft placeholders with professionally reviewed guidance before publishing.");
    const catalog = await ctx.db.get(version.catalogId);
    const current = catalog?.publishedVersionId ? await ctx.db.get(catalog.publishedVersionId) : null;
    if (current && current.guide.version >= version.guide.version) throw new ConvexError("Publish a newer version, not an older revision.");
    if (version.guide.assemblyKind && !args.assemblyId) throw new ConvexError("This guide requires its reviewed assembly before publication.");
    if (args.assemblyId) {
      const asset = await ctx.db.get(args.assemblyId);
      if (!asset || asset.status !== "reviewed" || !asset.storageId || !asset.generatedByTripo) throw new ConvexError("Choose a reviewed Tripo-origin assembly.");
      const ids = new Set(asset.parts.map(p => p.id));
      if (version.guide.steps.some(step => step.partIds.some(id => !ids.has(id)))) throw new ConvexError("Every guide part must map to a reviewed assembly part.");
    } else if (version.guide.steps.some(step => step.partIds.length > 0)) throw new ConvexError("Remove unmapped part references or attach a reviewed assembly.");
    await ctx.db.patch(version._id, {
      guide: { ...version.guide, status: "published" }, assemblyId: args.assemblyId,
      reviewedBy: reviewer.subject, reviewedAt: Date.now(),
    });
    await ctx.db.patch(version.catalogId, { publishedVersionId: version._id });
  },
});
export const unpublish = mutation({
  args: { guideVersionId: v.id("guideVersions") },
  handler: async (ctx, args) => {
    await admin(ctx);
    const version = await ctx.db.get(args.guideVersionId);
    if (!version || version.guide.status !== "published") throw new ConvexError("Published guide not found.");
    await ctx.db.patch(version._id, { withdrawn: true });
    const catalog = await ctx.db.get(version.catalogId);
    if (catalog?.publishedVersionId === version._id) await ctx.db.patch(catalog._id, { publishedVersionId: undefined });
  },
});
export const reviewAssembly = mutation({
  args: {
    assemblyId: v.id("assemblies"), parts: v.array(part), geometryReviewed: v.boolean(),
    applicabilityReviewed: v.boolean(), rightsReviewed: v.boolean(), mobileReviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const reviewer = await admin(ctx);
    const asset = await ctx.db.get(args.assemblyId);
    if (!asset || asset.status !== "draft" || !asset.storageId || !asset.generatedByTripo || !asset.mappingReady) throw new ConvexError("A draft Tripo-origin GLB with uniquely named mesh nodes is required. Clean unnamed or duplicate nodes in Blender first.");
    if (![args.geometryReviewed, args.applicabilityReviewed, args.rightsReviewed, args.mobileReviewed].every(Boolean)) {
      throw new ConvexError("Confirm geometry, safe applicability, rights, and mobile visual review.");
    }
    if (args.parts.length < 2 || args.parts.length > 40 || new Set(args.parts.map(p => p.id)).size !== args.parts.length) {
      throw new ConvexError("Provide 2–40 uniquely identified separate parts.");
    }
    const assigned = new Set<string>();
    for (const part of args.parts) {
      if (!/^[a-z0-9-]{1,80}$/.test(part.id)) throw new ConvexError("Use stable lowercase part IDs.");
      bounded(part.label, 100, "Part label", 1);
      bounded(part.description, 800, "Part description", 1);
      if (part.explodeOffset.length !== 3 || part.explodeOffset.some(n => !Number.isFinite(n) || Math.abs(n) > 10)) throw new ConvexError("Provide three finite explode coordinates within ±10.");
      if (!part.nodeNames.length || new Set(part.nodeNames).size !== part.nodeNames.length || part.nodeNames.some(n => !asset.nodeNames.includes(n) || assigned.has(n))) throw new ConvexError("Parts must reference unique mesh nodes in the uploaded GLB.");
      for (const name of part.nodeNames) assigned.add(name);
    }
    if (assigned.size !== asset.nodeNames.length) throw new ConvexError("Label every mesh node before review.");
    await ctx.db.patch(asset._id, { parts: args.parts, status: "reviewed", reviewedBy: reviewer.subject, reviewedAt: Date.now() });
  },
});
