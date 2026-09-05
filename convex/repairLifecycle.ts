import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ACTIVE_PHASES } from "./repairContracts";

export async function invalidateRepairs(ctx: MutationCtx, problemId: Id<"problems">) {
  const runs = await ctx.db.query("repairRuns").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  for (const run of runs) {
    if (ACTIVE_PHASES.includes(run.phase) || run.phase === "ready") {
      await ctx.db.patch(run._id, { phase: "cancelled", retryable: false, message: "Inputs or consent changed.", updatedAt: Date.now() });
    }
    const stages = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", run._id)).collect();
    for (const stage of stages) if (["queued", "running"].includes(stage.state)) await ctx.db.patch(stage._id, { state: "cancelled" });
  }
  const cache = await ctx.db.query("repairCache").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  for (const entry of cache) await ctx.db.patch(entry._id, { state: "invalid" });
}

export async function removeRepairs(ctx: MutationCtx, problemId: Id<"problems">) {
  const storage = new Set<Id<"_storage">>();
  const runs = await ctx.db.query("repairRuns").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  for (const run of runs) {
    if (run.modelStorageId) storage.add(run.modelStorageId);
    const stages = await ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", run._id)).collect();
    for (const stage of stages) await ctx.db.delete(stage._id);
    await ctx.db.delete(run._id);
  }
  const scenes = await ctx.db.query("repairSceneManifests").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  for (const scene of scenes) { storage.add(scene.storageId); await ctx.db.delete(scene._id); }
  const solutions = await ctx.db.query("repairSolutions").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  for (const solution of solutions) await ctx.db.delete(solution._id);
  const cache = await ctx.db.query("repairCache").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  for (const entry of cache) await ctx.db.delete(entry._id);
  for (const id of storage) {
    if (!await ctx.db.query("repairSceneManifests").withIndex("by_storage", q => q.eq("storageId", id)).first() &&
        !await ctx.db.query("repairRuns").filter(q => q.eq(q.field("modelStorageId"), id)).first() &&
        !await ctx.db.query("assemblies").filter(q => q.eq(q.field("storageId"), id)).first()) await ctx.storage.delete(id);
  }
}
