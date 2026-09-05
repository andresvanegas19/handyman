import { mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { outcome } from "./validators";
import { bounded, ownProblem } from "./lib";

export const save = mutation({
  args: { problemId: v.id("problems"), guideVersionId: v.id("guideVersions"), outcome, comment: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const problem = await ownProblem(ctx, args.problemId);
    const version = await ctx.db.get(args.guideVersionId);
    const analyses = await ctx.db.query("analyses").withIndex("by_problem", q => q.eq("problemId", args.problemId)).collect();
    if (!version || version.guide.status !== "published" || !analyses.some(a => a.result.guideVersionIds.includes(args.guideVersionId))) {
      throw new ConvexError("Feedback must refer to a published guide suggested for this problem.");
    }
    const previous = await ctx.db.query("feedback").withIndex("by_identity", q =>
      q.eq("owner", problem.owner).eq("problemId", args.problemId).eq("guideVersionId", args.guideVersionId)).unique();
    const values = { ...args, owner: problem.owner, comment: bounded(args.comment ?? "", 1000, "Comment"), updatedAt: Date.now() };
    await ctx.db.patch(problem._id, { selectedGuideVersionId: args.guideVersionId, updatedAt: Date.now() });
    if (previous) { await ctx.db.patch(previous._id, values); return previous._id; }
    return await ctx.db.insert("feedback", values);
  },
});
