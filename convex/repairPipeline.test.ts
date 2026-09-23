/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { compatible, validateMapping, validatePlan, type Mapping, type Recognition, type RepairPlan, type Research } from "./repairContracts";
import { inspectRepairGeometry } from "./repairGeometry";
import { trustedModelUrl } from "./repairModel";

const provider = vi.hoisted(() => ({ recognize: vi.fn(), research: vi.fn(), plan: vi.fn(), map: vi.fn() }));
vi.mock("./openrouter", () => ({ recognizeProduct: provider.recognize, draftRepair: provider.plan, mapRepairParts: provider.map }));
vi.mock("./firecrawl", async importOriginal => ({
  ...await importOriginal<typeof import("./firecrawl")>(),
  researchProduct: provider.research,
}));
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
  it("exposes next steps immediately and keeps fetched sources while a model is pending or fails", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "Clean this dusty external handle without changing its finish");
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    const pending = await client.query(api.repairPipeline.get, { problemId });
    expect(pending?.phase).toBe("recognizing");
    expect(pending?.recommendations?.items.length).toBeGreaterThan(0);
    expect(pending?.recommendations?.identification).toBeUndefined();
    expect(pending?.recommendations?.sources).toEqual([]);
    for (let i = 0; i < 4; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    expect(provider.plan).toHaveBeenCalledWith(recognition, research, "Clean this dusty external handle without changing its finish");
    const generating = await client.query(api.repairPipeline.get, { problemId });
    expect(generating?.phase).toBe("generating_model");
    expect(generating?.recommendations?.sources).toHaveLength(1);
    expect(generating?.solution).toBeUndefined();
    const args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.fail, { ...args, message: "Model provider unavailable", retryable: true });
    const failed = await client.query(api.repairPipeline.get, { problemId });
    expect(failed?.recommendations).toEqual(generating?.recommendations);
    expect(failed?.solution).toBeUndefined();
    await client.mutation(api.repairPipeline.cancel, { problemId });
    expect((await client.query(api.repairPipeline.get, { problemId }))?.recommendations).toBeUndefined();
  });

  it("does not research an uncertain referral or fabricate its identity", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, outcome: "referral", product: "", confidence: 0.2 }, model: "vision-model",
    });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model");
    expect(result?.recommendations?.identification).toBeUndefined();
    expect(result?.recommendations?.questions.length).toBeGreaterThan(0);
    expect(provider.research).not.toHaveBeenCalled();
    expect(provider.plan).not.toHaveBeenCalled();
  });

  it("continues to a preview when referral documentation fails without generating repair steps", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "Thermostat installation planning");
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, outcome: "referral", product: "thermostat" }, model: "vision-model",
    });
    provider.research.mockRejectedValueOnce(new Error("Provider request rejected (HTTP 429)."));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model");
    expect(result?.message).toContain("HTTP 429");
    expect(result?.recommendations?.sources).toHaveLength(0);
    expect(result?.solution).toBeUndefined();
    expect(result?.scene).toBeUndefined();
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    expect(provider.research).toHaveBeenCalledTimes(1);
    expect(provider.plan).not.toHaveBeenCalled();
  });
  it("persists private image-to-text independently of a refused repair and clears access on consent revocation", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const imageDescription = "A curved sink drain and a wrench are visible.";
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, product: "", outcome: "referral", imageDescription, features: ["P-trap", "wrench"] },
      model: "google/gemma-3-12b-it",
    });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model");
    expect(result?.recommendations?.imageDescription).toBe(imageDescription);
    expect(result?.recommendations?.visibleFeatures).toEqual(["P-trap", "wrench"]);
    expect(result?.recommendations?.items.length).toBeGreaterThan(0);
    expect(result?.solution).toBeUndefined();
    expect((await t.run(ctx => ctx.db.get(runId)))?.recognition?.imageDescription).toBe(imageDescription);
    await expect(t.withIdentity({ subject: "other" }).query(api.repairPipeline.get, { problemId })).rejects.toThrow("not found");
    await client.mutation(api.problems.setConsent, { problemId, consent: false });
    expect((await client.query(api.repairPipeline.get, { problemId }))?.recommendations).toBeUndefined();
  });

  it("exposes the recognition rate limit instead of the generic processing error", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.recognize.mockRejectedValueOnce(new Error("Provider request rejected (HTTP 429)."));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result).toMatchObject({ phase: "generating_model", retryable: false });
    expect(result?.message).toContain("Image caption unavailable");
    expect(result?.message).toContain("OpenRouter is temporarily rate limited (HTTP 429)");
    expect(provider.research).not.toHaveBeenCalled();
    expect(provider.plan).not.toHaveBeenCalled();
  });

  it("can retry mapping rate limits without repeating completed research or Tripo generation", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId);
    await finishModel(t, runId, "generation");
    await finishModel(t, runId, "segmentation");
    provider.map.mockRejectedValueOnce(new Error("Provider request rejected (HTTP 429)."));
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const failed = await client.query(api.repairPipeline.get, { problemId });
    expect(failed).toMatchObject({ phase: "failed", retryable: true });
    expect(failed?.message).toContain("HTTP 429");
    expect(failed?.solution).toBeUndefined();
    await client.mutation(api.repairPipeline.retry, { problemId });
    expect((await t.run(ctx => ctx.db.get(runId)))?.phase).toBe("mapping");
    await t.action(internal.repairPipeline.work, await active(t, runId));
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.phase).toBe("ready");
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    expect(provider.research).toHaveBeenCalledTimes(1);
    expect(provider.plan).toHaveBeenCalledTimes(1);
  });

  it("researches a recognized unsupported appliance before generating a non-instructional preview", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "My dishwasher displays E1");
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, product: "dishwasher", symptom: "error code", outcome: "referral" },
      model: "qwen/qwen3.8-flash",
    });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect(provider.recognize).toHaveBeenCalledWith("My dishwasher displays E1", expect.stringContaining("data:image/png;base64,"));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.phase).toBe("researching");
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model");
    expect(result?.recommendations?.identification?.product).toBe("dishwasher");
    expect(result?.recommendations?.visionModel).toBe("qwen/qwen3.8-flash");
    expect(result?.recommendations?.sources).toEqual([{ url: research.sources[0].url, title: research.sources[0].title }]);
    expect(result?.recommendations?.items.length).toBeGreaterThan(0);
    expect(result?.message).toContain("Found product documentation");
    expect(provider.research).toHaveBeenCalledTimes(1);
    expect(result?.scene).toBeUndefined();
    expect(result?.solution).toBeUndefined();
    expect(provider.plan).not.toHaveBeenCalled();
    expect((await t.run(ctx => ctx.db.get(runId)))?.generationTaskId).toBeUndefined();
    await expect(t.withIdentity({ subject: "other" }).query(api.repairPipeline.get, { problemId })).rejects.toThrow("not found");
    await client.mutation(api.problems.setConsent, { problemId, consent: false });
    expect((await client.query(api.repairPipeline.get, { problemId }))?.recommendations).toBeUndefined();
  });

  it("keeps immediate safety recommendations even when image recognition fails", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "Gas leak near the stove");
    provider.recognize.mockRejectedValueOnce(new Error("Provider unavailable"));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    expect((await client.query(api.repairPipeline.get, { problemId }))?.recommendations?.urgent).toBe(true);
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    expect(result?.phase).toBe("generating_model");
    expect(result?.recommendations?.items[0].title).toBe("Prioritize immediate safety");
    expect(result?.recommendations?.identification).toBeUndefined();
    expect(provider.research).not.toHaveBeenCalled();
    expect(provider.plan).not.toHaveBeenCalled();
  });

  it("keeps urgent warnings and skips research and planning while preparing a preview", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "Gas leak near the stove");
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, product: "stove", symptom: "gas leak", outcome: "referral" }, model: "vision-model",
    });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model");
    expect(result?.recommendations?.identification?.product).toBe("stove");
    expect(result?.recommendations?.urgent).toBe(true);
    expect(provider.research).not.toHaveBeenCalled();
  });

  it("allows old keyword-only refusals to explicitly retry image recognition with the saved photo", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "My dishwasher displays E1");
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.run(ctx => ctx.db.patch(runId, {
      phase: "referral", recognitionModel: "deterministic-safety-screen", retryable: false,
    }));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.retryable).toBe(true);
    await client.mutation(api.repairPipeline.retry, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect(provider.recognize).toHaveBeenCalledTimes(1);
  });

  it("retains identification and useful next steps if research fails", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.research.mockRejectedValueOnce(new Error("Provider request rejected (HTTP 429)."));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    for (let i = 0; i < 3; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model");
    expect(result?.recommendations?.identification?.product).toBe("cabinet");
    expect(result?.recommendations?.sources).toEqual([]);
    expect(result?.recommendations?.items.length).toBeGreaterThan(0);
    expect(result?.solution).toBeUndefined();
  });

  it("prepares a preview with an explicit missing-documentation message when no sources are found", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "Dishwasher error E1");
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, outcome: "referral", product: "dishwasher" }, model: "vision-model",
    });
    provider.research.mockResolvedValueOnce({ sources: [], images: [] });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model");
    expect(result?.recommendations?.sources).toEqual([]);
    expect(result?.recommendations?.items.length).toBeGreaterThan(0);
    expect(result?.message).toContain("No usable product documentation");
    expect(provider.research).toHaveBeenCalledTimes(1);
    expect(provider.plan).not.toHaveBeenCalled();
  });

  it("reports missing backend setup without exposing provider secrets or making requests", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("VISUAL_REPAIR_ENABLED", "false");
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "private-openrouter-key");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "0");
    const result = await t.query(internal.repairPipeline.configuration, {});
    expect(result).toEqual({ enabled: false, ready: false, missing: ["VISUAL_REPAIR_ENABLED", "FIRECRAWL_API_KEY", "TRIPO_DAILY_LIMIT"] });
    expect(JSON.stringify(result)).not.toContain("private-openrouter-key");
    expect(provider.recognize).not.toHaveBeenCalled();
    vi.stubEnv("VISUAL_REPAIR_ENABLED", "true");
    vi.stubEnv("FIRECRAWL_API_KEY", "private-firecrawl-key");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "4");
    expect(await t.query(internal.repairPipeline.configuration, {})).toEqual({ enabled: true, ready: true, missing: [] });
  });

  it("logs owner-authorized viewer failures without invalidating a valid server model", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules), { client, problemId, runId } = await ready(t);
    const result = await client.query(api.repairPipeline.get, { problemId });
    const sceneId = result!.scene!.id;
    expect(result?.recommendations?.items.length).toBeGreaterThan(0);
    await client.mutation(api.repairPipeline.reportViewerFailure, { problemId, sceneId, code: "download_failed" });
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({
      event: "viewer.failed", problemId, sceneId, runId, code: "download_failed", operation: "browser_report",
    }));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.phase).toBe("ready");
    await expect(t.withIdentity({ subject: "other" }).mutation(api.repairPipeline.reportViewerFailure, {
      problemId, sceneId, code: "render_failed",
    })).rejects.toThrow("not found");
    await expect(client.mutation(api.repairPipeline.reportViewerFailure, {
      problemId, sceneId: "someone-elses-scene", code: "render_failed",
    })).rejects.toThrow("do not match");
    await expect(client.mutation(api.repairPipeline.reportViewerFailure, {
      problemId, code: "render_failed",
    })).rejects.toThrow("do not match");
    await client.mutation(api.problems.setConsent, { problemId, consent: false });
    await expect(client.mutation(api.repairPipeline.reportViewerFailure, {
      problemId, sceneId, code: "render_failed",
    })).rejects.toThrow("authorized ready repair");
  });

  it("bounds browser diagnostics independently of generation budgets", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules), { client, problemId } = await ready(t);
    const args = { problemId, code: "model_missing" as const };
    for (let i = 0; i < 30; i++) await client.mutation(api.repairPipeline.reportViewerFailure, args);
    await expect(client.mutation(api.repairPipeline.reportViewerFailure, args)).rejects.toThrow("Rate limit");
  });

  it("logs a missing stored model without discarding advisory guidance", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules), { client, problemId, runId } = await ready(t);
    await t.run(async ctx => {
      const run = await ctx.db.get(runId);
      await ctx.storage.delete(run!.modelStorageId!);
    });
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("failed");
    expect(result?.message).toContain("interactive model");
    expect(result?.recommendations?.items.length).toBeGreaterThan(0);
    expect(result?.solution).toBeUndefined();
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "model.unavailable", runId, code: "stored_model_unavailable" }));
  });

  it("logs correlated stages, cache decisions, and ready model without private payloads", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const { problemId, runId } = await ready(t);
    expect(info).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "run.created", problemId, runId }));
    for (const phase of ["recognizing", "checking_cache", "researching", "planning", "generating_model", "segmenting", "mapping", "validating"]) {
      expect(info).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "stage.started", runId, phase, stageId: expect.any(String) }));
    }
    expect(info).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "cache.checked", runId, status: "miss" }));
    expect(info).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "run.ready", problemId, runId, sceneId: expect.any(String) }));
    const output = JSON.stringify(info.mock.calls);
    expect(output).not.toContain("Dusty external handle");
    expect(output).not.toContain(research.sources[0].excerpt);
  });

  it("logs a categorical provider failure without raw error content", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const { client, problemId } = await fixture(t);
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    provider.recognize.mockRejectedValueOnce(new Error("Private request https://private.example?token=secret"));
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "stage.error", problemId, runId, phase: "recognizing", code: "processing_failed" }));
    expect(warn).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "stage.failed", runId, nextPhase: "generating_model" }));
    expect(JSON.stringify([...error.mock.calls, ...warn.mock.calls])).not.toContain("token=secret");
  });

  it("deduplicates retried intake creation by owner and client request ID", async () => {
    const t = convexTest(schema, modules), client = t.withIdentity(owner);
    const args = { workflow: "visual" as const, text: "Dust on the handle", consent: true, clientRequestId: "a-unique-client-request-123" };
    const problemId = await client.mutation(api.problems.create, args);
    expect(await client.mutation(api.problems.create, args)).toBe(problemId);
    expect(await t.run(ctx => ctx.db.query("problems").collect())).toHaveLength(1);
    await expect(client.mutation(api.problems.create, { ...args, text: "Different issue" })).rejects.toThrow("different inputs");
    const other = await t.withIdentity({ subject: "other" }).mutation(api.problems.create, args);
    expect(other).not.toBe(problemId);
  });
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
    const history = await client.query(api.problems.list, {});
    expect(history.find(problem => problem._id === problemId)?.visualPhase).toBe("generating_model");
    const stages = await t.run(ctx => ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", runId)).collect());
    await t.action(internal.repairPipeline.work, { runId, stageId: stages[0]._id });
    expect(provider.recognize).toHaveBeenCalledTimes(1);
  });
  it("recognizes current safety before exact cache reuse and skips downstream provider calls", async () => {
    const t = convexTest(schema, modules), first = await ready(t);
    const view = await first.client.query(api.repairPipeline.get, { problemId: first.problemId });
    expect(view?.phase).toBe("ready"); expect(view?.solution?.steps[0].partIds).toEqual(["handle"]);
    expect(view?.scene?.source).toBe("generated");
    expect(view?.preview).toBeUndefined();
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: view!.scene!.id, owner: "other" })).toBeNull();
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: view!.scene!.id, owner: "owner" })).not.toBeNull();
    const second = await fixture(t);
    const secondRun = await second.client.mutation(api.repairPipeline.start, { problemId: second.problemId });
    expect((await t.run(ctx => ctx.db.get(secondRun)))?.phase).toBe("recognizing");
    expect((await t.run(ctx => ctx.db.get(secondRun)))?.plan).toBeUndefined();
    for (let i = 0; i < 3; i++) await t.action(internal.repairPipeline.work, await active(t, secondRun));
    expect((await second.client.query(api.repairPipeline.get, { problemId: second.problemId }))?.cacheHit).toBe(true);
    expect(provider.recognize).toHaveBeenCalledTimes(2);
    expect(provider.research).toHaveBeenCalledTimes(1); expect(provider.plan).toHaveBeenCalledTimes(1);
    expect(await t.run(ctx => ctx.db.query("catalogProblems").collect())).toEqual([]);
  });
  it("retires dependent results on consent revocation and preserves shared storage on deletion", async () => {
    const t = convexTest(schema, modules), first = await ready(t);
    const firstView = await first.client.query(api.repairPipeline.get, { problemId: first.problemId });
    const second = await fixture(t);
    const runId = await second.client.mutation(api.repairPipeline.start, { problemId: second.problemId });
    for (let i = 0; i < 3; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
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
  it("cannot use a previous safe cache when fresh recognition refuses the same evidence", async () => {
    const t = convexTest(schema, modules);
    await ready(t);
    const { client, problemId } = await fixture(t);
    provider.recognize.mockResolvedValueOnce({ recognition: { ...recognition, outcome: "referral", summary: "Current safety screening refuses this procedure." }, model: "current-policy" });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect(await client.query(api.repairPipeline.get, { problemId })).toMatchObject({
      phase: "researching", cacheHit: false,
    });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model"); expect(result?.cacheHit).toBe(false); expect(result?.solution).toBeUndefined();
    expect((await t.run(ctx => ctx.db.get(runId)))?.modelStorageId).toBeUndefined();
    expect(provider.plan).toHaveBeenCalledTimes(1);
    const stages = await t.run(ctx => ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", runId)).collect());
    expect(stages.map(stage => stage.phase)).toEqual(["recognizing", "researching", "generating_model"]);
  });
  it("keeps recognition and research while falling back to a preview after planning fails", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.plan.mockRejectedValueOnce(new Error("Unavailable"));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    for (let i = 0; i < 4; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.phase).toBe("generating_model");
    expect((await t.run(ctx => ctx.db.get(runId)))?.intent).toBe("preview");
    expect(provider.recognize).toHaveBeenCalledTimes(1); expect(provider.research).toHaveBeenCalledTimes(1);
    expect(provider.plan).toHaveBeenCalledTimes(1);
  });
  it("visualizes inconclusive recognition without inventing supporting research", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.recognize.mockResolvedValueOnce({ recognition: { ...recognition, confidence: 0.3 }, model: "fixture" });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.phase).toBe("generating_model");
    expect(provider.research).not.toHaveBeenCalled();
  });
  it.each([
    "Repair instructions require a reviewed safety policy for this procedure.",
    "Mechanical repair applicability, visible screw access, or source prerequisites are not established.",
    "Repeated tightening of the same target is not supported.",
    "No supported source-grounded repair was found.",
  ])("withholds unsupported procedures while generating an approximate preview: %s", async message => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.plan.mockRejectedValueOnce(new Error(message));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    for (let i = 0; i < 4; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.phase).toBe("generating_model"); expect(result?.retryable).toBe(false); expect(result?.solution).toBeUndefined();
    expect(result?.message).toContain("reviewed guidance");
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

describe("private approximate model previews", () => {
  async function previewGeneration(t: ReturnType<typeof convexTest>, text = "Washer knob detached") {
    const setup = await fixture(t, text);
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, outcome: "referral", product: "washing machine", imageDescription: "A washer with a detached knob." },
      model: "vision-model",
    });
    const runId = await setup.client.mutation(api.repairPipeline.start, { problemId: setup.problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    await t.action(internal.repairPipeline.work, await active(t, runId));
    return { ...setup, runId };
  }
  async function readyPreview(t: ReturnType<typeof convexTest>) {
    const setup = await previewGeneration(t);
    await finishModel(t, setup.runId, "preview");
    await t.action(internal.repairPipeline.work, await active(t, setup.runId));
    return setup;
  }
  it("returns a ready preview without a solution, labels, mapping, or segmentation", async () => {
    const t = convexTest(schema, modules), { client, problemId, runId } = await readyPreview(t);
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result).toMatchObject({ phase: "ready", preview: { id: expect.any(String) } });
    expect(result?.solution).toBeUndefined();
    expect(result?.scene).toBeUndefined();
    expect(result?.message).toContain("not a repair guide");
    expect(result?.recommendations?.imageDescription).toBe("A washer with a detached knob.");
    expect(result?.recommendations?.sources).toHaveLength(1);
    expect(result?.recommendations?.items).toEqual([]);
    expect(result?.recommendations?.questions).toEqual([]);
    const run = await t.run(ctx => ctx.db.get(runId));
    const scene = await t.run(ctx => ctx.db.get(run!.sceneId!));
    expect(scene?.kind).toBe("preview");
    expect(scene?.mapping).toBeUndefined();
    expect(run?.plan).toBeUndefined();
    expect(await t.run(ctx => ctx.db.query("repairSolutions").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("repairCache").collect())).toEqual([]);
    expect(provider.plan).not.toHaveBeenCalled();
    expect(provider.map).not.toHaveBeenCalled();
    const stages = await t.run(ctx => ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", runId)).collect());
    expect(stages.map(s => s.phase)).toEqual(["recognizing", "researching", "generating_model", "validating"]);
  });
  it("authorizes preview files only for the current owner with consent and revision", async () => {
    const t = convexTest(schema, modules), { client, problemId, runId } = await readyPreview(t);
    const result = await client.query(api.repairPipeline.get, { problemId });
    const sceneId = result!.preview!.id;
    const file = await t.query(internal.repairPipeline.privateSceneFile, { sceneId, owner: "owner" });
    expect(file).not.toBeNull();
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(file!.storageId)))).toBe(true);
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId, owner: "other" })).toBeNull();
    await expect(t.withIdentity({ subject: "other" }).query(api.repairPipeline.get, { problemId })).rejects.toThrow("not found");
    await client.mutation(api.repairPipeline.reportViewerFailure, { problemId, sceneId, code: "download_failed" });
    await t.run(ctx => ctx.db.patch(runId, { revision: 999 }));
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId, owner: "owner" })).toBeNull();
    await t.run(async ctx => ctx.db.patch(runId, { revision: (await ctx.db.get(problemId))!.revision }));
    await client.mutation(api.problems.setConsent, { problemId, consent: false });
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId, owner: "owner" })).toBeNull();
    expect((await client.query(api.repairPipeline.get, { problemId }))?.preview).toBeUndefined();
  });
  it("reuses only a private exact-evidence preview and preserves shared storage on deletion", async () => {
    const t = convexTest(schema, modules), first = await readyPreview(t);
    const second = await previewGeneration(t);
    expect((await t.run(ctx => ctx.db.get(second.runId)))?.phase).toBe("validating");
    await t.action(internal.repairPipeline.work, await active(t, second.runId));
    const view = await second.client.query(api.repairPipeline.get, { problemId: second.problemId });
    expect(view).toMatchObject({ phase: "ready", cacheHit: true, preview: { id: expect.any(String) } });
    await first.client.mutation(api.problems.remove, { problemId: first.problemId });
    expect(await t.query(internal.repairPipeline.privateSceneFile, { sceneId: view!.preview!.id, owner: "owner" })).not.toBeNull();
    await second.client.mutation(api.problems.setConsent, { problemId: second.problemId, consent: false });
    const third = await previewGeneration(t);
    expect((await t.run(ctx => ctx.db.get(third.runId)))?.phase).toBe("generating_model");
    expect((await t.run(ctx => ctx.db.get(third.runId)))?.cacheHit).toBe(false);
  });
  it("does not reuse preview geometry for different photos, descriptions, or owners", async () => {
    const t = convexTest(schema, modules);
    await readyPreview(t);
    const differentText = await previewGeneration(t, "Washer knob cracked");
    expect((await t.run(ctx => ctx.db.get(differentText.runId)))?.cacheHit).toBe(false);
    for (const subject of ["owner", "other"]) {
      const client = t.withIdentity({ subject });
      const problemId = await client.mutation(api.problems.create, { workflow: "visual", text: "Washer knob detached", consent: true });
      await t.run(async ctx => {
        const storageId = await ctx.storage.store(new Blob([subject === "owner" ? "different-photo" : "photo"], { type: "image/png" }));
        await ctx.db.insert("media", { owner: subject, problemId, kind: "photo", state: "ready", storageId, mime: "image/png", expiresAt: Date.now() + 600_000 });
      });
      provider.recognize.mockRejectedValueOnce(new Error("Unavailable"));
      const runId = await client.mutation(api.repairPipeline.start, { problemId });
      await t.action(internal.repairPipeline.work, await active(t, runId));
      expect((await t.run(ctx => ctx.db.get(runId)))?.phase).toBe("generating_model");
      expect((await t.run(ctx => ctx.db.get(runId)))?.cacheHit).toBe(false);
    }
  });
  it("completes an unnamed model after recognition fails without inventing an identity or caption", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.recognize.mockRejectedValueOnce(new Error("Provider request rejected (HTTP 429)."));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const generation = await active(t, runId);
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { file_token: "original-photo" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "preview-task" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "preview-task", status: "success", output: { model_url: "https://cdn.tripo3d.ai/preview.glb" } } })))
      .mockResolvedValueOnce(new Response(fixtureGlb("")));
    await t.action(internal.repairModel.submit, generation);
    await t.action(internal.repairModel.submit, generation);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).input).toBe("original-photo");
    await t.action(internal.repairModel.poll, { ...generation, attempt: 0 });
    await t.action(internal.repairModel.poll, { ...generation, attempt: 0 });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect(fetch).toHaveBeenCalledTimes(4);
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.preview).toBeDefined();
    expect(result?.recommendations?.identification).toBeUndefined();
    expect(result?.recommendations?.imageDescription).toBeUndefined();
    expect(result?.message).toContain("Image caption unavailable");
    expect(provider.research).not.toHaveBeenCalled();
    expect(provider.plan).not.toHaveBeenCalled();
    expect(provider.map).not.toHaveBeenCalled();
  });
  it("preserves the immediate safety warning after a preview becomes ready", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "Gas leak near the stove");
    provider.recognize.mockRejectedValueOnce(new Error("Unavailable"));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    await finishModel(t, runId, "preview");
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.preview).toBeDefined();
    expect(result?.recommendations?.urgent).toBe(true);
    expect(result?.recommendations?.items).toEqual([]);
    expect(result?.recommendations?.questions).toEqual([]);
    expect(result?.recommendations?.summary).toContain("Prioritize immediate safety");
    expect(result?.recommendations?.summary).toContain("local emergency services");
    expect(result?.solution).toBeUndefined();
    expect(provider.plan).not.toHaveBeenCalled();
  });
  it("keeps unknown washer model and brand unknown when mechanical drafting refuses generic sources", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t, "Washer timer knob detached");
    provider.recognize.mockResolvedValueOnce({
      recognition: { ...recognition, product: "washer timer knob", brand: "", model: "", confidence: 0.9 },
      model: "openai/gpt-4o-mini",
    });
    provider.plan.mockRejectedValueOnce(new Error("Mechanical repair applicability, visible screw access, or source prerequisites are not established."));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    for (let i = 0; i < 4; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    await finishModel(t, runId, "preview");
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const result = await client.query(api.repairPipeline.get, { problemId });
    expect(result?.preview).toBeDefined();
    expect(result?.solution).toBeUndefined();
    expect(result?.recommendations?.identification).toMatchObject({ product: "washer timer knob", brand: "", model: "", confidence: 0.9 });
    expect(result?.recommendations?.sources).toHaveLength(1);
    expect(result?.recommendations?.items).toEqual([]);
    expect(result?.recommendations?.questions).toEqual([]);
    expect(result?.recommendations?.summary).toContain("do not establish");
  });
  it("generates a preview instead of planning when an identified object has no supporting evidence", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.research.mockResolvedValueOnce({ sources: [], images: [] });
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    for (let i = 0; i < 3; i++) await t.action(internal.repairPipeline.work, await active(t, runId));
    expect((await t.run(ctx => ctx.db.get(runId)))?.intent).toBe("preview");
    expect(provider.plan).not.toHaveBeenCalled();
    await finishModel(t, runId, "preview");
    await t.action(internal.repairPipeline.work, await active(t, runId));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.preview).toBeDefined();
  });
  it("keeps invalid output hidden and retries the same preview task after a deadline", async () => {
    const t = convexTest(schema, modules), { client, problemId, runId } = await previewGeneration(t);
    const args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: "invalid-preview" });
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "invalid-preview", status: "success", output: { model_url: "https://cdn.tripo3d.ai/invalid.glb" } } })))
      .mockResolvedValueOnce(new Response(new Uint8Array(32)));
    await t.action(internal.repairModel.poll, { ...args, attempt: 0 });
    expect(await client.query(api.repairPipeline.get, { problemId })).toMatchObject({ phase: "failed", retryable: true });
    expect((await client.query(api.repairPipeline.get, { problemId }))?.preview).toBeUndefined();
    await client.mutation(api.repairPipeline.retry, { problemId });
    const stage = await t.run(ctx => ctx.db.get(args.stageId));
    vi.setSystemTime(stage!.deadline + 1);
    await t.mutation(internal.repairPipeline.expire, args);
    await client.mutation(api.repairPipeline.retry, { problemId });
    expect(await active(t, runId)).toEqual(args);
    expect((await t.run(ctx => ctx.db.get(args.stageId)))?.providerTaskId).toBe("invalid-preview");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["referral", "needs_input", "failed"] as const)("explicitly retries an old %s run into a preview without reupload or automatic replay", async phase => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.run(ctx => ctx.db.patch(runId, { phase, resumePhase: "planning", recognition, retryable: false }));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.retryable).toBe(true);
    expect(await client.mutation(api.repairPipeline.start, { problemId })).toBe(runId);
    expect((await t.run(ctx => ctx.db.get(runId)))?.phase).toBe(phase);
    expect(await client.mutation(api.repairPipeline.retry, { problemId })).toBe(runId);
    expect((await t.run(ctx => ctx.db.get(runId)))?.phase).toBe("generating_model");
    expect((await t.run(ctx => ctx.db.get(runId)))?.intent).toBe("preview");
    expect(provider.recognize).not.toHaveBeenCalled();
    expect(provider.plan).not.toHaveBeenCalled();
  });
  it("resumes the same preview task after failure and refuses an identical new paid run", async () => {
    const t = convexTest(schema, modules), { client, problemId, runId } = await previewGeneration(t);
    const args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: "existing-preview-task" });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network"));
    await t.action(internal.repairModel.poll, { ...args, attempt: 0 });
    const second = await fixture(t, "Washer knob detached");
    await expect(second.client.mutation(api.repairPipeline.start, { problemId: second.problemId })).rejects.toThrow("existing provider task");
    await client.mutation(api.repairPipeline.retry, { problemId });
    expect(await active(t, runId)).toEqual(args);
    expect((await t.run(ctx => ctx.db.get(args.stageId)))?.providerTaskId).toBe("existing-preview-task");
    await t.action(internal.repairModel.submit, args);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await t.run(ctx => ctx.db.query("repairStages").withIndex("by_run", q => q.eq("runId", runId)).collect())).filter(s => s.phase === "generating_model")).toHaveLength(1);
  });
  it("never replays an ambiguous preview submission even when recognition failed", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    provider.recognize.mockRejectedValueOnce(new Error("Unavailable"));
    const runId = await client.mutation(api.repairPipeline.start, { problemId });
    await t.action(internal.repairPipeline.work, await active(t, runId));
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { file_token: "photo" } })))
      .mockRejectedValueOnce(new Error("Timeout"));
    const args = await active(t, runId);
    await t.action(internal.repairModel.submit, args);
    await expect(client.mutation(api.repairPipeline.retry, { problemId })).rejects.toThrow("unknown");
    const second = await fixture(t);
    await expect(second.client.mutation(api.repairPipeline.start, { problemId: second.problemId })).rejects.toThrow("unknown outcome");
    await t.action(internal.repairModel.submit, args);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retains budget, stale-result, and geometry validation gates for previews", async () => {
    const t = convexTest(schema, modules), { client, problemId, runId } = await previewGeneration(t);
    const args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    vi.stubEnv("TRIPO_DAILY_LIMIT", "0");
    await expect(t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" })).rejects.toThrow("TRIPO_DAILY_LIMIT");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "50");
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: "stale-preview" });
    await client.mutation(api.problems.setConsent, { problemId, consent: false });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([fixtureGlb()])));
    expect(await t.mutation(internal.repairModel.completeModel, { ...args, storageId, nodeNames: ["handle"], triangleCount: 1, hash: "fixture" })).toBe(false);
    expect((await client.query(api.repairPipeline.get, { problemId }))?.preview).toBeUndefined();
    expect(() => inspectRepairGeometry(fixtureGlb("", true))).toThrow("collapsed");
    expect(() => inspectRepairGeometry(fixtureGlb(""))).not.toThrow();
  });
});

describe("durable Tripo generation and semantic segmentation", () => {
  it.each([
    ["upload", 401, "photo_upload", false],
    ["submission", 429, "generation_submission", true],
  ])("logs the failed %s operation and HTTP code without private provider data", async (step, httpStatus, operation, ambiguous) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId), args = await active(t, runId);
    const fetch = vi.spyOn(globalThis, "fetch");
    if (step === "submission") fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { file_token: "private-photo-token" } })));
    fetch.mockResolvedValueOnce(new Response("private provider response", { status: httpStatus }));
    await t.action(internal.repairModel.submit, args);
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({
      event: "tripo.submission.failed", ...args, phase: "generating_model",
      operation, code: `provider_http_${httpStatus}`, ambiguous, elapsedMs: expect.any(Number),
    }));
    expect((await client.query(api.repairPipeline.get, { problemId }))?.retryable).toBe(!ambiguous);
    const logs = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    expect(logs).not.toContain("private-photo-token");
    expect(logs).not.toContain("private provider response");
  });

  it("logs polling reschedules and distinguishes geometry validation failures", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules), { problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId), args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: "existing-task" });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "existing-task", status: "running" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "existing-task", status: "success", output: { model_url: "https://cdn.tripo3d.ai/private.glb?token=secret" } } })))
      .mockResolvedValueOnce(new Response(new Uint8Array(32)));
    await t.action(internal.repairModel.poll, { ...args, attempt: 0 });
    expect(info).toHaveBeenCalledWith("[repair]", expect.objectContaining({ event: "tripo.poll.scheduled", ...args, attempt: 1, requestId: "existing-task" }));
    await t.action(internal.repairModel.poll, { ...args, attempt: 1 });
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({
      event: "tripo.poll.failed", ...args, operation: "model_validation",
      requestId: "existing-task", code: "invalid_model_geometry",
    }));
    expect(JSON.stringify([...info.mock.calls, ...error.mock.calls])).not.toContain("token=secret");
  });

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
    await client.mutation(api.problems.setConsent, { problemId, consent: false });
    await client.mutation(api.problems.setConsent, { problemId, consent: true });
    await expect(client.mutation(api.repairPipeline.start, { problemId })).rejects.toThrow("unknown outcome");
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId), args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    const stage = await t.run(ctx => ctx.db.get(args.stageId));
    vi.setSystemTime(stage!.deadline + 1);
    await t.mutation(internal.repairPipeline.expire, args);
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({
      event: "stage.expired", ...args, phase: "generating_model", code: "stage_deadline_exceeded", ambiguous: true, retryable: false,
    }));
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
  it("rejects completed geometry after its stage deadline even before expiration runs", async () => {
    const t = convexTest(schema, modules), { client, problemId } = await fixture(t);
    const runId = await toGeneration(t, problemId), args = await active(t, runId);
    await t.mutation(internal.repairPipeline.claim, args);
    await t.mutation(internal.repairPipeline.reserveProvider, { ...args, provider: "tripo" });
    await t.mutation(internal.repairModel.setTask, { ...args, providerTaskId: "existing-task" });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([fixtureGlb()], { type: "model/gltf-binary" })));
    const stage = await t.run(ctx => ctx.db.get(args.stageId));
    vi.setSystemTime(stage!.deadline);
    expect(await t.mutation(internal.repairModel.completeModel, {
      ...args, storageId, nodeNames: ["handle"], triangleCount: 1, hash: "fixture-hash",
    })).toBe(false);
    expect((await t.run(ctx => ctx.db.get(runId)))?.modelStorageId).toBeUndefined();
    await t.mutation(internal.repairPipeline.expire, args);
    expect(await client.query(api.repairPipeline.get, { problemId })).toMatchObject({
      phase: "failed", retryable: true,
    });
    expect(await client.mutation(api.repairPipeline.retry, { problemId })).toBe(runId);
    expect((await t.run(ctx => ctx.db.get(args.stageId)))?.providerTaskId).toBe("existing-task");
  });
});

describe("conservative applicability and actual geometry", () => {
  it("rejects invalid or duplicate citation provenance even for reviewed references", () => {
    expect(() => validatePlan(plan, { ...research, sources: [{ ...research.sources[0], url: "http://example.com/care" }] })).toThrow("HTTPS");
    expect(() => validatePlan(plan, { ...research, sources: [research.sources[0], research.sources[0]] })).toThrow("distinct");
  });
  it("matches explicit camel-case semantic labels without accepting incomplete identities", () => {
    const screwPlan = { ...plan, parts: [{ ...plan.parts[0], label: "Handle screw" }] };
    const screwMapping = { parts: [{ ...mapping.parts[0], label: "Handle screw", nodeNames: ["HandleScrew"] }] };
    expect(() => validateMapping(screwPlan, screwMapping, ["HandleScrew"])).not.toThrow();
    expect(() => validateMapping(screwPlan, { parts: [{ ...screwMapping.parts[0], nodeNames: ["Handle"] }] }, ["Handle"])).toThrow("identity");
  });
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
