import { mutation } from "./_generated/server";
import { admin } from "./lib";
import { validateGuide } from "./admin";
import { STARTER_GUIDES } from "../src/lib/catalog";

export const run = mutation({
  args: {},
  handler: async ctx => {
    await admin(ctx);
    let inserted = 0;
    for (const guide of STARTER_GUIDES) {
      validateGuide(guide);
      const existing = await ctx.db.query("catalogProblems").withIndex("by_slug", q => q.eq("slug", guide.slug)).unique();
      if (existing) continue;
      const catalogId = await ctx.db.insert("catalogProblems", { slug: guide.slug });
      await ctx.db.insert("guideVersions", { catalogId, guide: { ...guide, status: "draft" } });
      inserted++;
    }
    return { inserted };
  },
});
