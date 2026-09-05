/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { compatible, validateMapping, type Mapping, type Recognition, type RepairPlan, type Research } from "./repairContracts";
import { inspectRepairGeometry } from "./repairGeometry";
import { trustedModelUrl } from "./repairModel";

const provider = vi.hoisted(() => ({ recognize: vi.fn(), research: vi.fn(), plan: vi.fn(), map: vi.fn() }));
vi.mock("./openrouter", () => ({ recognizeProduct: provider.recognize, draftRepair: provider.plan, mapRepairParts: provider.map }));
vi.mock("./firecrawl", () => ({ researchProduct: provider.research }));
const modules = import.meta.glob("./**/*.ts");
const owner = { subject: "owner" };
const recognition: Recognition = {
  outcome: "identified", summary: "Dust on the visible handle.", product: "cabinet", brand: "Example",
  model: "C1", variant: "single handle", symptom: "dust", features: ["external handle"], prerequisites: ["undamaged"], confidence: 0.95,
};
const research: Research = {
  sources: [{ id: "care", url: "https://example.com/care", title: "Care manual", excerpt: "Wipe the external handle with a dry soft cloth." }],
  images: [{ url: "https://example.com/handle.png", pageUrl: "https://example.com/care", title: "Handle" }],
};
const plan: RepairPlan = {
  title: "Clean the handle", summary: "Gentle external care.", prerequisites: ["Undamaged handle"], stopConditions: ["Stop if damaged"],
  parts: [{ id: "handle", label: "Handle", description: "Visible external handle" }],
  steps: [{ id: "wipe", title: "Wipe handle", description: "Wipe with a dry soft cloth.", partIds: ["handle"], sourceIds: ["care"] }],
};
const mapping: Mapping = { parts: [{ ...plan.parts[0], nodeNames: ["handle"], explodeOffset: [0, 0, 0] }] };
function fixtureGlb(name = "handle", collapsed = false) {
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, count: 3, componentType: 5126, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ name, mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }));
  const size = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(size + 64);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + size); bytes.set(json, 20);
  view.setUint32(20 + size, 36, true); view.setUint32(24 + size, 0x004e4942, true);
  if (!collapsed) { view.setFloat32(28 + size + 12, 1, true); view.setFloat32(28 + size + 28, 1, true); }
  return bytes;
}
async function fixture(t: ReturnType<typeof convexTest>, text = "Dusty external handle") {
  const client = t.withIdentity(owner);
  const problemId = await client.mutation(api.problems.create, { workflow: "visual", text, consent: true });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["photo"], { type: "image/png" })));
  await t.run(ctx => ctx.db.insert("media", { owner: "owner", problemId, kind: "photo", state: "ready", storageId, mime: "image/png", bytes: 5, expiresAt: Date.now() + 600_000 }));
  return { client, problemId };
}
async function active(t: ReturnType<typeof convexTest>, runId: Id<"repairRuns">): Promise<{ runId: Id<"repairRuns">; stageId: Id<"repairStages"> }> {
  const run = await t.run(ctx => ctx.db.get(runId));
  return { runId, stageId: run!.activeStageId! };
}
async function toGeneration(t: ReturnType<typeof convexTest>, problemId: Id<"problems">) {
  const runId = await t.withIdentity(owner).mutation(api.repairPipeline.start, { problemId });
  for (let i = 0; i < 4; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
  expect((await t.run(ctx => ctx.db.get(runId)))?.phase).toBe("generating_model");
  return runId;
}
async function finishModel(t: ReturnType<typeof convexTest>, runId: Id<"repairRuns">, phase: string) {
  const args = await active(t, runId);
  await t.mutation(internal.repairPipeline.claim, args);
  await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
  await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: `${phase}-task` });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob([fixtureGlb()], { type: "model/gltf-binary" })));
  await t.mutation(internal.repairModel.completeModel, { ...args, storageId, nodeNames: ["handle"], triangleCount: 1, hash: "fixture-hash" });
}
async function ready(t: ReturnType<typeof convexTest>) {
  const setup = await fixture(t);
  const runId = await toGeneration(t, setup.problemId);
  await finishModel(t, runId, "generation");
  await finishModel(t, runId, "segmentation");
  await t.action(internal.repairPipeline.work, await active(t, runId));
  await t.action(internal.repairPipeline.work, await active(t, runId));
  return { ...setup, runId };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv("VISUAL_REPAIR_ENABLED", "true"); vi.stubEnv("FIRECRAWL_DAILY_LIMIT", "20");
  vi.stubEnv("TRIPO_API_KEY", "fixture"); vi.stubEnv("TRIPO_MODEL_VERSION", "v3.0-20250812"); vi.stubEnv("TRIPO_DAILY_LIMIT", "50");
  provider.recognize.mockReset().mockResolvedValue({ recognition, model: "fixture" });
  provider.research.mockReset().mockResolvedValue(research);
  provider.plan.mockReset().mockResolvedValue({ plan, model: "fixture" });
  provider.map.mockReset().mockResolvedValue({ mapping, model: "fixture" });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("visual repair pipeline", () => {
  it("preserves legacy creation and enforces visual intake and owner boundaries", async () => {
    const t = convexTest(schema, modules), client = t.withIdentity(owner);
    const legacy = await client.mutation(api.problems.create, { text: "", consent: false });
    expect((await client.query(api.problems.get, { problemId: legacy })).problem.workflow).toBeUndefined();
    await expect(client.mutation(api.problems.create, { workflow: "visual", text: " ", consent: true })).rejects.toThrow("written");
    const problemId = await client.mutation(api.problems.create, { workflow: "visual", text: "Dust", consent: true });
    await expect(client.mutation(api.repairPipeline.start, { problemId })).rejects.toThrow("photo");
    await expect(t.withIdentity({ subject: "other" }).query(api.repairPipeline.get, { problemId })).rejects.toThrow("not found");
  });
  it("claims once, persists stages, and never reveals a draft before model readiness", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId);
    expect(await client.mutation(api.repairPipeline.start, { problemId })).toBe(runId);
    const view = await client.query(api.repairPipeline.get, { problemId });
    expect(view?.phase).toBe("generating_model"); expect(view?.solution).toBeUndefined(); expect(view?.scene).toBeUndefined();
    const stages = await t.run(ctx => ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", runId)).collect());
    await t.action(internal.repairPipeline.work, { runId, stageId: stages[0]._id });
    expect(provider.recognize).toHaveBeenCalledTimes(1);
  });
  it("automatically reaches private ready and reuses an exact cache without provider calls", async () => {
    const t = convexTest(schema, modules), first = await ready(t);
    const view = await first.client.query(api.repairPipeline.get, { problemId: first.problemId });
    expect(view?.phase).toBe("ready"); expect(view?.solution?.steps[0].partIds).toEqual(["handle"]);
    expect(view?.scene?.source).toBe("generated");
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: view!.scene!.id, owner: "other" })).toBeNull();
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: view!.scene!.id, owner: "owner" })).not.toBeNull();
    const second = await fixture(t);
    const secondRun = await second.client.mutation(api.repairPipeline.start, { problemId: second.problemId });
    await t.action(internal.repairPipeline.work, await active(t, secondRun));
    expect((await second.client.query(api.repairPipeline.get, { problemId: second.problemId }))?.cacheHit).toBe(true);
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    expect(provider.research).toHaveBeenCalledTimes(1); expect(provider.plan).toHaveBeenCalledTimes(1);
    expect(await t.run(ctx => ctx.db.query("catalogProblems").collect())).toEqual([]);
  });
  it("retires dependent results on consent revocation and preserves shared storage on deletion", async () => {
    const t = convexTest(schema, modules), first = await ready(t);
    const firstView = await first.client.query(api.repairPipeline.get, { problemId: first.problemId });
    const second = await fixture(t);
    const runId = await second.client.mutation(api.repairPipeline.start, { problemId: second.problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const secondView = await second.client.query(api.repairPipeline.get, { problemId: second.problemId });
    await first.client.mutation(api.problems.remove, { problemId: first.problemId });
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: firstView!.scene!.id, owner: "owner" })).toBeNull();
    const file = await t.query(internal.repairPipeline.privateSceneFile, { sceneId: secondView!.scene!.id, owner: "owner" });
    expect(file).not.toBeNull();
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(file!.storageId)))).toBe(true);
    await second.client.mutation(api.problems.setConsent, { problemId: second.problemId, consent: false });
    expect((await second.client.query(api.repairPipeline.get, { problemId: second.problemId }))?.phase).toBe("cancelled");
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: secondView!.scene!.id, owner: "owner" })).toBeNull();
  });
  it("rejects stale completion after edits without another provider call", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    const args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await client.mutation(api.problems.update, { problemId, text: "Different issue", transcriptConfirmed: false });
    expect(await t.mutation(internal.repairPipeline.complete, { ...args, recognition, model: "late" })).toBe(false);
    expect(await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "ai" })).toBe(false);
  });
  it("keeps recognition and research on an explicit planning retry", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.plan.mockRejectedValueOnce(new Error("Unavailable"));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    for (let i = 0; i < 4; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.retryable).toBe(true);
    await client.mutation(api.repairPipeline.retry, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect(provider.recognize).toHaveBeenCalledTimes(1); expect(provider.research).toHaveBeenCalledTimes(1);
    expect(provider.plan).toHaveBeenCalledTimes(2);
  });
  it("stops inconclusive recognition and hazards without research", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.recognize.mockResolvedValueOnce({ recognition: { ...recognition, confidence: 0.3 }, model: "fixture" });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.phase).toBe("needs_input");
    expect(provider.research).not.toHaveBeenCalled();
  });
  it("rejects fused or anonymous part mappings instead of claiming ready", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId);
    await finishModel(t, runId, "generation"); await finishModel(t, runId, "segmentation");
    provider.map.mockResolvedValueOnce({ mapping: { parts: [{ ...mapping.parts[0], nodeNames: ["mesh_0"] }] }, model: "fixture" });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("failed"); expect(result?.message).toContain("mapping_unavailable"); expect(result?.solution).toBeUndefined();
  });
  it("reuses only explicitly reviewed compatible references and blocks withdrawn ones", async () => {
    vi.stubEnv("ADMIN_SUBJECTS", "admin");
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob([fixtureGlb()], { type: "model/gltf-binary" }));
      const assemblyId = await ctx.db.insert("assemblies", {
        status: "reviewed", prompt: "Visible handle", source: "Licensed fixture", license: "CC0",
        storageId, nodeNames: ["handle"], triangleCount: 1, mappingReady: true, parts: mapping.parts,
        reviewedBy: "admin", reviewedAt: Date.now(), generatedByTripo: true,
      });
      const catalogId = await ctx.db.insert("catalogProblems", { slug: "handle-care" });
      const guideVersionId = await ctx.db.insert("guideVersions", {
        catalogId, assemblyId, reviewedBy: "admin", reviewedAt: Date.now(),
        guide: { slug: "handle-care", title: plan.title, summary: plan.summary, category: "Furniture",
          difficulty: "Easy", duration: "5 minutes", symptoms: ["Dust"], tools: ["Cloth"],
          prerequisites: plan.prerequisites, stopConditions: plan.stopConditions, status: "published", version: 1,
          steps: plan.steps.map(({ title, description, partIds }) => ({ title, description, partIds })) },
      });
      await ctx.db.patch(catalogId, { publishedVersionId: guideVersionId });
      return { guideVersionId };
    });
    await expect(t.withIdentity(owner).mutation(api.repairPipeline.registerReviewedReference, {
      ...ids, recognition, research, safetyReviewed: true, rightsReviewed: true,
    })).rejects.toThrow("Administrator");
    await t.withIdentity({ subject: "admin" }).mutation(api.repairPipeline.registerReviewedReference, {
      ...ids, recognition, research, safetyReviewed: true, rightsReviewed: true,
    });
    const { client, problemId } = await fixture(t);
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    for (let i = 0; i < 3; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("ready"); expect(result?.scene?.source).toBe("reference"); expect(result?.cacheHit).toBe(true);
    expect(provider.research).not.toHaveBeenCalled(); expect(provider.plan).not.toHaveBeenCalled(); expect(provider.map).not.toHaveBeenCalled();
    await t.withIdentity({ subject: "admin" }).mutation(api.admin.unpublish, ids);
    expect((await client.query(api.repairPipeline.get, { problemId }))?.solution).toBeUndefined();
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: result!.scene!.id, owner: "owner" })).toBeNull();
  });
  it("keeps private caches invisible to other owners", async () => {
    const t = convexTest(schema, modules);
    await ready(t);
    const other = t.withIdentity({ subject: "other" });
    const problemId = await other.mutation(api.problems.create, { workflow: "visual", text: "Dusty external handle", consent: true });
    await t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["photo"], { type: "image/png" }));
      await ctx.db.insert("media", { owner: "other", problemId, kind: "photo", state: "ready", storageId, mime: "image/png", expiresAt: Date.now() + 600_000 });
    });
    const runId = await other.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await other.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("researching"); expect(result?.cacheHit).toBe(false); expect(result?.solution).toBeUndefined();
  });
});

describe("durable Tripo generation and semantic segmentation", () => {
  it("uploads, submits and polls each paid task only once", async () => {
    const t = convexTest(schema, modules), { problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId);
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { file_token: "photo-token" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "generation" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "generation", status: "success", output: { model_url: "https://cdn.tripo3d.ai/model.glb" } } })))
      .mockResolvedValueOnce(new Response(fixtureGlb()))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "segmentation" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "segmentation", status: "success", output: { model_url: "https://cdn.tripo3d.ai/segmented.glb" } } })))
      .mockResolvedValueOnce(new Response(fixtureGlb()));
    const generation = await active(t, runId);
    await t.action(internal.repairModel.submit, generation); await t.action(internal.repairModel.submit, generation);
    await t.action(internal.repairModel.poll, { ...generation, attempt: 0 });
    await t.action(internal.repairModel.poll, { ...generation, attempt: 0 });
    const segmentation = await active(t, runId);
    await t.action(internal.repairModel.submit, segmentation);
    expect(fetch.mock.calls[4][0]).toBe("https://openapi.tripo3d.ai/v3/mesh/segment");
    expect(JSON.parse(fetch.mock.calls[4][1]!.body as string)).toEqual({ input: "generation", model: "v2.0-20260430", segmentation_granularity: "detailed", split_by_connectivity: true });
    await t.action(internal.repairModel.poll, { ...segmentation, attempt: 0 });
    expect(fetch).toHaveBeenCalledTimes(7);
    expect((await t.run(ctx => ctx.db.get(runId)))?.phase).toBe("mapping");
  });
  it("never replays ambiguous paid submissions, including after timeout", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId);
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { file_token: "photo-token" } })))
      .mockRejectedValueOnce(new Error("Timeout"));
    const args = await active(t, runId);
    await t.action(internal.repairModel.submit, args);
    expect((await client.query(api.repairPipeline.get, { problemId }))?.retryable).toBe(false);
    await expect(client.mutation(api.repairPipeline.retry, { problemId })).rejects.toThrow("unknown");
    await t.action(internal.repairModel.submit, args);
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = await fixture(t);
    await expect(second.client.mutation(api.repairPipeline.start, { problemId: second.problemId })).rejects.toThrow("unknown outcome");
  });
  it("resumes polling the existing task after a safe read fails", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId), args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: "existing-task" });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network"));
    await t.action(internal.repairModel.poll, { ...args, attempt: 0 });
    await client.mutation(api.repairPipeline.retry, { problemId });
    expect((await t.run(ctx => ctx.db.get(args.stageId)))?.providerTaskId).toBe("existing-task");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("turns a crashed paid submission into a non-replayable timeout", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId), args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    const stage = await t.run(ctx => ctx.db.get(args.stageId));
    vi.setSystemTime(stage!.deadline + 1);
    await t.mutation(internal.repairPipeline.expire, args);
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("failed"); expect(result?.retryable).toBe(false);
    await expect(client.mutation(api.repairPipeline.retry, { problemId })).rejects.toThrow("unknown");
  });
  it("records late provider task IDs for reconciliation but never schedules stale results", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId), args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    await client.mutation(api.problems.setConsent, { problemId, consent: false });
    expect(await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: "late-task" })).toBe(false);
    expect((await t.run(ctx => ctx.db.get(args.stageId)))?.providerTaskId).toBe("late-task");
    expect(await t.mutation(internal.repairModel.pollClaim, { ...args, attempt: 0 })).toBeNull();
  });
});

describe("conservative applicability and actual geometry", () => {
  it("requires all product details, symptom, features, and prerequisites to match", () => {
    expect(compatible(recognition, recognition)).toBe(true);
    for (const changes of [{ variant: "double handle" }, { symptom: "loose" }, { brand: "unknown" }, { features: [] }, { prerequisites: [] }]) {
      expect(compatible(recognition, { ...recognition, ...changes })).toBe(false);
    }
  });
  it("rejects arbitrary mesh names and nonfinite or collapsed geometry", () => {
    expect(() => validateMapping(plan, { parts: [{ ...mapping.parts[0], nodeNames: ["mesh_0"] }] }, ["mesh_0"])).toThrow("identity");
    expect(() => inspectRepairGeometry(fixtureGlb(), mapping)).not.toThrow();
    expect(() => inspectRepairGeometry(fixtureGlb("handle", true), mapping)).toThrow("collapsed");
    expect(() => trustedModelUrl("http://cdn.tripo3d.ai/model.glb")).toThrow();
    expect(() => trustedModelUrl("https://cdn.tripo3d.ai.evil.test/model.glb")).toThrow();
    expect(() => trustedModelUrl("https://127.0.0.1/model.glb")).toThrow();
  });
});
