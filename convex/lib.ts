import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { invalidateRepairs } from "./repairLifecycle";

export async function identity(ctx: Pick<QueryCtx | ActionCtx, "auth">) {
  const user = await ctx.auth.getUserIdentity();
  if (!user) throw new ConvexError("Your private browser session is not ready. Refresh and try again.");
  return { ...user, subject: guestOwner(user.subject) };
}
// Convex Auth subjects include a session ID; ownership must survive session renewal.
export function guestOwner(subject: string) { return subject.split("|")[0]; }
export function allowedAdmin(subject: string) {
  return (process.env.ADMIN_SUBJECTS ?? "").split(",").map(s => s.trim()).filter(Boolean).includes(subject);
}
export async function admin(ctx: Pick<QueryCtx | ActionCtx, "auth">) {
  const user = await identity(ctx);
  if (!allowedAdmin(user.subject)) throw new ConvexError("Administrator access required.");
  return user;
}
export async function ownProblem(ctx: QueryCtx | MutationCtx, id: Id<"problems">) {
  const user = await identity(ctx);
  const problem = await ctx.db.get(id);
  if (!problem || problem.owner !== user.subject) throw new ConvexError("Problem not found.");
  return problem;
}
export function bounded(value: string, max: number, name: string, min = 0) {
  if (value.length < min || value.length > max) throw new ConvexError(`${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
export async function quota(ctx: MutationCtx, key: string, limit: number, windowMs = 3_600_000) {
  const window = Math.floor(Date.now() / windowMs);
  const previous = await ctx.db.query("quotas").withIndex("by_key", q => q.eq("key", key)).unique();
  const count = previous?.window === window ? previous.count + 1 : 1;
  if (count > limit) throw new ConvexError("Rate limit reached. Please try again later.");
  if (previous) await ctx.db.patch(previous._id, { window, count });
  else await ctx.db.insert("quotas", { key, window, count });
}
export async function aiQuota(ctx: MutationCtx) {
  const limit = Number(process.env.AI_DAILY_LIMIT ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new ConvexError("AI_DAILY_LIMIT must be configured between 1 and 10000.");
  await quota(ctx, "ai:global", limit, 86_400_000);
}
export async function cancelProblemJobs(ctx: MutationCtx, problemId: Id<"problems">) {
  await invalidateRepairs(ctx, problemId);
  const jobs = await ctx.db.query("jobs").withIndex("by_problem", q => q.eq("problemId", problemId)).collect();
  for (const job of jobs) if (job.state === "running" || job.state === "queued") {
    await ctx.db.patch(job._id, { state: "cancelled" });
  }
}
export const providerFailure = "Provider processing failed. Check configuration or try again later.";
