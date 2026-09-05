/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { STARTER_GUIDES } from "../src/lib/catalog";
import type { Guide } from "../src/lib/domain";
import { inspectMedia } from "./mediaValidation";
import { inspectGlb } from "./glb";
import { webmDuration } from "./webm";

const modules = import.meta.glob("./**/*.ts");
const owner = { subject: "owner", issuer: "https://example.convex.site", tokenIdentifier: "https://example.convex.site|owner" };
const stranger = { subject: "stranger", issuer: "https://example.convex.site", tokenIdentifier: "https://example.convex.site|stranger" };
const reviewer = { subject: "admin", issuer: "https://example.convex.site", tokenIdentifier: "https://example.convex.site|admin" };
function safeGuide(): Guide {
  return {
    slug: "window-track", title: "Clean an accessible window track", summary: "Gentle care for an accessible undamaged window track.",
    category: "Doors & windows", difficulty: "Easy", duration: "10 min", symptoms: ["Dust in track"],
    tools: ["Soft cloth"], prerequisites: ["Accessible from the floor", "No glass damage"],
    stopConditions: ["Stop if damaged"], steps: [{ title: "Check care instructions", description: "Follow the manufacturer's approved surface care instructions.", partIds: [] }],
    status: "draft", version: 1,
  };
}
function fixtureGlb() {
  const json = JSON.stringify({
    asset: { version: "2.0" }, buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, count: 3, componentType: 5126, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: "knob", mesh: 0 }, { name: "screw", mesh: 0 }], scenes: [{ nodes: [0, 1] }], scene: 0,
  });
  const encoded = new TextEncoder().encode(json);
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + 36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength); bytes.set(encoded, 20);
  view.setUint32(20 + jsonLength, 36, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  return bytes;
}
async function published(t: ReturnType<typeof convexTest>) {
  const a = t.withIdentity(reviewer);
  const guideVersionId = await a.mutation(api.admin.saveDraft, { guide: safeGuide() });
  await a.mutation(api.admin.publish, { guideVersionId, safetyReviewed: true, rightsReviewed: true });
  return guideVersionId;
}
async function sceneFixture(t: ReturnType<typeof convexTest>) {
  const client = t.withIdentity(owner);
  const guideVersionId = await published(t);
  const problemId = await client.mutation(api.problems.create, { text: "Dust in accessible window track", consent: true });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["photo-fixture"], { type: "image/png" })));
  const photoId = await t.run(ctx => ctx.db.insert("media", {
    owner: owner.subject, problemId, kind: "photo", state: "ready", storageId,
    mime: "image/png", bytes: 13, expiresAt: Date.now() + 600_000,
  }));
  const jobId = await client.mutation(api.problems.analyze, { problemId });
  await t.mutation(internal.jobs.claim, { jobId });
  await t.mutation(internal.jobs.completeAnalysis, {
    jobId, model: "fixture",
    result: { outcome: "suggestions", summary: "Low-risk care may apply.", evidence: [], questions: [], guideVersionIds: [guideVersionId] },
  });
  return { client, problemId, photoId, guideVersionId };
}
beforeEach(() => { vi.stubEnv("ADMIN_SUBJECTS", "admin"); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("private photo-to-model spatial context", () => {
  beforeEach(() => {
    vi.stubEnv("TRIPO_API_KEY", "fixture-key-not-real");
    vi.stubEnv("TRIPO_MODEL_VERSION", "v3.0-20250812");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "10");
  });
  it("requires ownership, explicit Tripo consent, and a photo from the same repair", async () => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId } = await sceneFixture(t);
    const other = t.withIdentity(stranger);
    await expect(other.query(api.tripo.scene, { problemId })).rejects.toThrow("not found");
    await expect(other.mutation(api.tripo.requestScene, { problemId, photoId, consent: true })).rejects.toThrow("not found");
    await expect(client.mutation(api.tripo.requestScene, { problemId, photoId, consent: false })).rejects.toThrow("Consent");
    const foreignProblem = await other.mutation(api.problems.create, { text: "A different repair", consent: true });
    const foreignPhoto = await t.run(ctx => ctx.db.insert("media", { owner: stranger.subject, problemId: foreignProblem, kind: "photo", state: "ready", expiresAt: Date.now() }));
    await expect(client.mutation(api.tripo.requestScene, { problemId, photoId: foreignPhoto, consent: true })).rejects.toThrow("belonging");
  });
  it.each(["draft", "follow_up", "referral"] as const)("blocks generation for %s without calling the provider", async state => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId } = await sceneFixture(t);
    await t.run(ctx => ctx.db.patch(problemId, { state }));
    const fetch = vi.spyOn(globalThis, "fetch");
    expect((await client.query(api.tripo.scene, { problemId })).eligible).toBe(false);
    await expect(client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true })).rejects.toThrow("low-risk");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks withdrawn guidance and unconfigured spending", async () => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId, guideVersionId } = await sceneFixture(t);
    vi.stubEnv("TRIPO_DAILY_LIMIT", "0");
    expect((await client.query(api.tripo.scene, { problemId })).configured).toBe(false);
    await expect(client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true })).rejects.toThrow("TRIPO_DAILY_LIMIT");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "10");
    await t.withIdentity(reviewer).mutation(api.admin.unpublish, { guideVersionId });
    await expect(client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true })).rejects.toThrow("low-risk");
  });
  it("uploads the selected image, creates one task, polls, and privately stores its GLB", async () => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId } = await sceneFixture(t);
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { file_token: "image-fixture" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "scene-task" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "scene-task", status: "running" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "scene-task", status: "success", output: { model_url: "https://cdn.tripo3d.ai/scene.glb" } } })))
      .mockResolvedValueOnce(new Response(fixtureGlb()));
    const sceneId = await client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true });
    expect(await client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true })).toBe(sceneId);
    const scene = await t.run(ctx => ctx.db.get(sceneId));
    const jobId = scene!.jobId;
    await t.action(internal.tripo.generate, { jobId });
    await t.action(internal.tripo.generate, { jobId });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://openapi.tripo3d.ai/v3/files");
    const form = fetch.mock.calls[0][1]!.body as FormData;
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(fetch.mock.calls[1][0]).toBe("https://openapi.tripo3d.ai/v3/generation/image-to-model");
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({
      input: "image-fixture", model: "v3.0-20250812", face_limit: 100_000, texture: true, pbr: true,
    });
    await t.action(internal.tripo.poll, { jobId, attempt: 0 });
    expect(fetch.mock.calls[2][0]).toBe("https://openapi.tripo3d.ai/v3/tasks/scene-task");
    expect((await client.query(api.tripo.scene, { problemId })).scene?.state).toBe("running");
    await t.action(internal.tripo.poll, { jobId, attempt: 1 });
    const result = await client.query(api.tripo.scene, { problemId });
    expect(result.scene?.ready).toBe(true);
    expect(result.scene).not.toHaveProperty("storageId");
    expect(result.scene).not.toHaveProperty("url");
    expect(await t.query(internal.tripo.privateSceneFile, { sceneId, owner: stranger.subject })).toBeNull();
    const file = await t.query(internal.tripo.privateSceneFile, { sceneId, owner: owner.subject });
    expect(file?.storageId).toBeDefined();
    await t.mutation(internal.cleanup.discardUnreferenced, { storageId: file!.storageId });
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(file!.storageId)))).toBe(true);
    expect(await t.withIdentity(reviewer).query(api.admin.assets, {})).toEqual([]);
    expect((await client.query(api.problems.get, { problemId })).problem.state).toBe("suggestions");
    await client.mutation(api.problems.remove, { problemId });
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(file!.storageId)))).toBe(false);
    expect(await t.run(ctx => ctx.db.get(sceneId))).toBeNull();
    expect(await t.query(internal.tripo.privateSceneFile, { sceneId, owner: owner.subject })).toBeNull();
  });
  it.each(["revision", "consent", "photo", "deletion"] as const)("rejects late results after %s changes", async change => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId } = await sceneFixture(t);
    const sceneId = await client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true });
    const scene = await t.run(ctx => ctx.db.get(sceneId));
    const jobId = scene!.jobId;
    await t.mutation(internal.jobs.claim, { jobId });
    await t.mutation(internal.tripo.setTask, { jobId, providerTaskId: "fixture" });
    if (change === "revision") await client.mutation(api.problems.update, { problemId, text: "Updated input", transcriptConfirmed: false });
    if (change === "consent") await client.mutation(api.problems.setConsent, { problemId, consent: false });
    if (change === "photo") await client.mutation(api.uploads.remove, { mediaId: photoId });
    if (change === "deletion") await client.mutation(api.problems.remove, { problemId });
    expect(await t.query(internal.tripo.data, { jobId })).toBeNull();
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["late-asset"])));
    expect(await t.mutation(internal.tripo.ingest, { jobId, storageId, nodeNames: [], triangleCount: 1, mappingReady: false })).toBe(false);
    expect(await t.query(internal.tripo.privateSceneFile, { sceneId, owner: owner.subject })).toBeNull();
  });
  it("records rejected uploads without submitting another paid request", async () => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId } = await sceneFixture(t);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: 100, message: "Rejected" })));
    const sceneId = await client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true });
    const scene = await t.run(ctx => ctx.db.get(sceneId));
    await t.action(internal.tripo.generate, { jobId: scene!.jobId });
    expect(fetch).toHaveBeenCalledOnce();
    expect((await client.query(api.tripo.scene, { problemId })).scene?.state).toBe("failed");
    expect((await client.query(api.problems.get, { problemId })).problem.state).toBe("suggestions");
  });
  it("does not submit a paid task if consent is revoked during image upload", async () => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId } = await sceneFixture(t);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      await client.mutation(api.problems.setConsent, { problemId, consent: false });
      return new Response(JSON.stringify({ code: 0, data: { file_token: "image-fixture" } }));
    });
    const sceneId = await client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true });
    const scene = await t.run(ctx => ctx.db.get(sceneId));
    await t.action(internal.tripo.generate, { jobId: scene!.jobId });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await t.query(internal.tripo.data, { jobId: scene!.jobId })).toBeNull();
  });
  it("expires scene jobs without losing the safe analysis", async () => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId } = await sceneFixture(t);
    const sceneId = await client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true });
    const scene = await t.run(ctx => ctx.db.get(sceneId));
    vi.setSystemTime(Date.now() + 901_000);
    await t.mutation(internal.jobs.expire, { jobId: scene!.jobId });
    expect((await client.query(api.tripo.scene, { problemId })).scene?.state).toBe("failed");
    expect((await client.query(api.problems.get, { problemId })).problem.state).toBe("suggestions");
  });
  it("rejects results when the reviewed guide is withdrawn mid-generation", async () => {
    const t = convexTest(schema, modules);
    const { client, problemId, photoId, guideVersionId } = await sceneFixture(t);
    const sceneId = await client.mutation(api.tripo.requestScene, { problemId, photoId, consent: true });
    const scene = await t.run(ctx => ctx.db.get(sceneId));
    await t.mutation(internal.jobs.claim, { jobId: scene!.jobId });
    await t.mutation(internal.tripo.setTask, { jobId: scene!.jobId, providerTaskId: "fixture" });
    await t.withIdentity(reviewer).mutation(api.admin.unpublish, { guideVersionId });
    expect(await t.query(internal.tripo.data, { jobId: scene!.jobId })).toBeNull();
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["late-asset"])));
    expect(await t.mutation(internal.tripo.ingest, { jobId: scene!.jobId, storageId, nodeNames: [], triangleCount: 1, mappingReady: false })).toBe(false);
  });
});

describe("private ownership and publication", () => {
  it("round-trips door visual cues and rejects invalid cue lengths", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(reviewer);
    const guide = STARTER_GUIDES.find(item => item.assemblyKind === "door")!;
    await a.mutation(api.admin.saveDraft, { guide });
    expect((await a.query(api.admin.list, {}))[0].guide).toEqual(guide);
    const visual = guide.steps[0].visual!;
    for (const force of ["", "x".repeat(801)]) {
      await expect(a.mutation(api.admin.saveDraft, {
        guide: { ...guide, steps: [{ ...guide.steps[0], visual: { ...visual, force } }] },
      })).rejects.toThrow("Visual force");
    }
    await expect(t.withIdentity(owner).mutation(api.admin.saveDraft, { guide })).rejects.toThrow("Administrator");
  });

  it("preserves anonymous ownership across renewed sessions without sharing another guest's data", async () => {
    const t = convexTest(schema, modules);
    const first = t.withIdentity({ ...owner, subject: "guest-user|first-session" });
    const renewed = t.withIdentity({ ...owner, subject: "guest-user|renewed-session" });
    const other = t.withIdentity({ ...stranger, subject: "other-guest|other-session" });
    const problemId = await first.mutation(api.problems.create, { text: "My drawer sticks", consent: true });
    expect((await renewed.query(api.problems.get, { problemId })).problem.owner).toBe("guest-user");
    expect(await other.query(api.problems.list, {})).toEqual([]);
    await expect(other.query(api.problems.get, { problemId })).rejects.toThrow("not found");
  });
  it("requires authentication and denies all cross-owner problem operations", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.problems.create, { text: "Dust", consent: true })).rejects.toThrow("browser session");
    const a = t.withIdentity(owner);
    const b = t.withIdentity(stranger);
    const problemId = await a.mutation(api.problems.create, { text: "Dust in window track", consent: true });
    expect(await b.query(api.problems.list, {})).toEqual([]);
    await expect(b.query(api.problems.get, { problemId })).rejects.toThrow("not found");
    await expect(b.mutation(api.problems.update, { problemId, text: "Changed", transcriptConfirmed: false })).rejects.toThrow("not found");
    await expect(b.mutation(api.problems.remove, { problemId })).rejects.toThrow("not found");
    await expect(b.mutation(api.uploads.reserve, { problemId, kind: "photo" })).rejects.toThrow("not found");
    await expect(b.mutation(api.problems.analyze, { problemId })).rejects.toThrow("not found");
    await expect(b.mutation(api.problems.transcribe, { problemId })).rejects.toThrow("not found");
    expect((await a.query(api.problems.get, { problemId })).problem.owner).toBe("owner");
  });
  it("seeds only drafts idempotently and prohibits non-admin access", async () => {
    const t = convexTest(schema, modules);
    await expect(t.withIdentity(owner).mutation(api.seed.run, {})).rejects.toThrow("Administrator");
    const a = t.withIdentity(reviewer);
    expect(await a.mutation(api.seed.run, {})).toEqual({ inserted: 6 });
    expect(await a.mutation(api.seed.run, {})).toEqual({ inserted: 0 });
    expect(await t.query(api.catalog.list, {})).toEqual([]);
    expect(await t.query(api.catalog.detail, { slug: STARTER_GUIDES[0].slug })).toBeNull();
    const drafts = await a.query(api.admin.list, {});
    expect(drafts).toHaveLength(6);
    await expect(a.mutation(api.admin.publish, { guideVersionId: drafts[0]._id, safetyReviewed: true, rightsReviewed: true })).rejects.toThrow("draft");
    await expect(t.withIdentity(owner).query(api.admin.list, {})).rejects.toThrow("Administrator");
    await expect(t.withIdentity(owner).query(api.admin.scheduledFailures, {})).rejects.toThrow("Administrator");
    expect(await a.query(api.admin.scheduledFailures, {})).toEqual([]);
  });
  it("publishes only reviewed versions, preserves immutable history, and withdraws public access", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(reviewer);
    const id = await a.mutation(api.admin.saveDraft, { guide: safeGuide() });
    await expect(a.mutation(api.admin.publish, { guideVersionId: id, safetyReviewed: false, rightsReviewed: true })).rejects.toThrow("reviewer");
    await a.mutation(api.admin.publish, { guideVersionId: id, safetyReviewed: true, rightsReviewed: true });
    const result = await t.query(api.catalog.detail, { slug: "window-track" });
    expect(result?.guide._id).toBe(id);
    expect(result?.assembly).toBeNull();
    await expect(a.mutation(api.admin.saveDraft, { guide: safeGuide() })).rejects.toThrow("immutable");
    await a.mutation(api.admin.unpublish, { guideVersionId: id });
    expect(await t.query(api.catalog.detail, { slug: "window-track" })).toBeNull();
    expect(await t.query(api.catalog.version, { guideVersionId: id })).toBeNull();
  });
  it("returns exact historical published revisions without exposing drafts or withdrawn guidance", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(reviewer);
    const first = await published(t);
    const second = await a.mutation(api.admin.saveDraft, { guide: { ...safeGuide(), version: 2, title: "Updated track guidance" } });
    expect(await t.query(api.catalog.version, { guideVersionId: second })).toBeNull();
    await a.mutation(api.admin.publish, { guideVersionId: second, safetyReviewed: true, rightsReviewed: true });
    expect((await t.query(api.catalog.detail, { slug: "window-track" }))?.guide._id).toBe(second);
    expect((await t.query(api.catalog.version, { guideVersionId: first }))?.guide.title).toBe(safeGuide().title);
    expect((await t.query(api.catalog.version, { guideVersionId: first }))?.guide.version).toBe(1);
    await a.mutation(api.admin.unpublish, { guideVersionId: first });
    expect(await t.query(api.catalog.version, { guideVersionId: first })).toBeNull();
    expect((await t.query(api.catalog.detail, { slug: "window-track" }))?.guide._id).toBe(second);
  });
});

describe("asynchronous state and deletion", () => {
  it("shares the AI request budget across anonymous browsers", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "1");
    const t = convexTest(schema, modules);
    const first = t.withIdentity(owner);
    const other = t.withIdentity(stranger);
    const firstId = await first.mutation(api.problems.create, { text: "Dust", consent: true });
    const otherId = await other.mutation(api.problems.create, { text: "A sticky drawer", consent: true });
    const jobId = await first.mutation(api.problems.analyze, { problemId: firstId });
    expect(await first.mutation(api.problems.analyze, { problemId: firstId })).toBe(jobId);
    await expect(other.mutation(api.problems.analyze, { problemId: otherId })).rejects.toThrow("Rate limit");
  });
  it.each([
    "The accessible faucet outlet has reduced water flow.",
    "My faucet has reduced water flow at one outlet.",
  ])("allows clear faucet-outlet context through catalog matching: %s", async text => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key-not-real");
    const t = convexTest(schema, modules);
    const reviewerClient = t.withIdentity(reviewer);
    const guideVersionId = await reviewerClient.mutation(api.admin.saveDraft, {
      guide: {
        ...safeGuide(), slug: "accessible-aerator", title: "Accessible faucet aerator care",
        category: "Plumbing", summary: "Low-risk care for an accessible faucet aerator with reduced water flow.",
        symptoms: ["Reduced flow at an accessible faucet outlet"],
      },
    });
    await reviewerClient.mutation(api.admin.publish, { guideVersionId, safetyReviewed: true, rightsReviewed: true });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        outcome: "suggestions", summary: "The reviewed aerator guide may be applicable.",
        evidence: ["Reported reduced faucet flow"], questions: [], guideVersionIds: [guideVersionId],
      }) } }],
    })));
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text, consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.action(internal.ai.analyze, { jobId });
    const result = await a.query(api.problems.get, { problemId });
    expect(result.analysis?.result.outcome).toBe("suggestions");
    expect(result.analysis?.result.guideVersionIds).toEqual([guideVersionId]);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    "The electrical outlet needs repair.",
    "The power outlet next to the faucet does not work.",
    "The outlet does not work.",
    "Water from the faucet is dripping into the outlet.",
    "The wall socket needs repair.",
  ])("keeps electrical or uncertain connections in deterministic referral: %s", async text => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text, consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.action(internal.ai.analyze, { jobId });
    const result = await a.query(api.problems.get, { problemId });
    expect(result.analysis?.result.outcome).toBe("referral");
    expect(result.analysis?.model).toBe("deterministic-safety-screen");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a structured provider response referencing an unknown guide", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key-not-real");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        outcome: "suggestions", summary: "Potential match", evidence: [], questions: [], guideVersionIds: ["invented-guide"],
      }) } }],
    }), { status: 200 }));
    const t = convexTest(schema, modules);
    await published(t);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Dust in window track", consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.action(internal.ai.analyze, { jobId });
    const result = await a.query(api.problems.get, { problemId });
    expect(result.problem.state).toBe("failed");
    expect(result.analysis).toBeNull();
  });
  it("accepts valid catalog-grounded provider fixtures and preserves observations", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key-not-real");
    const t = convexTest(schema, modules);
    const guideVersionId = await published(t);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        outcome: "suggestions", summary: "A possible match, not a confirmed diagnosis.", evidence: ["Reported surface dust"], questions: [], guideVersionIds: [guideVersionId],
      }) } }],
    }), { status: 200 }));
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Dust in window track", consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.action(internal.ai.analyze, { jobId });
    expect((await a.query(api.problems.get, { problemId })).analysis?.result.guideVersionIds).toEqual([guideVersionId]);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("ignores stale analysis after an edit and claims a job only once", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const guideVersionId = await published(t);
    const problemId = await a.mutation(api.problems.create, { text: "Dust", consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    expect(await a.mutation(api.problems.analyze, { problemId })).toBe(jobId);
    expect(await t.mutation(internal.jobs.completeAnalysis, {
      jobId, model: "fixture", result: { outcome: "suggestions", summary: "Premature", evidence: [], questions: [], guideVersionIds: [guideVersionId] },
    })).toBe(false);
    expect(await t.mutation(internal.jobs.claim, { jobId })).not.toBeNull();
    expect(await t.mutation(internal.jobs.claim, { jobId })).toBeNull();
    await a.mutation(api.problems.update, { problemId, text: "Updated dust", transcriptConfirmed: false });
    expect(await t.mutation(internal.jobs.completeAnalysis, {
      jobId, model: "fixture", result: { outcome: "suggestions", summary: "Potential match", evidence: [], questions: [], guideVersionIds: [guideVersionId] },
    })).toBe(false);
    expect((await a.query(api.problems.get, { problemId })).analysis).toBeNull();
  });
  it("deletes private records and storage and prevents late job resurrection", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Dust", consent: true });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["private photo"])));
    await t.run(ctx => ctx.db.insert("media", {
      owner: owner.subject, problemId, storageId, state: "ready", kind: "photo", expiresAt: Date.now() + 60_000,
    }));
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.mutation(internal.jobs.claim, { jobId });
    await a.mutation(api.problems.remove, { problemId });
    expect(await t.run(ctx => ctx.storage.get(storageId))).toBeNull();
    expect(await t.mutation(internal.jobs.completeAnalysis, {
      jobId, model: "fixture", result: { outcome: "referral", summary: "No match", evidence: [], questions: [], guideVersionIds: [] },
    })).toBe(false);
    expect(await t.run(ctx => ctx.db.query("jobs").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("analyses").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("media").collect())).toEqual([]);
  });
  it("requires consent and transcript confirmation before processing", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Dust", consent: false });
    await expect(a.mutation(api.problems.analyze, { problemId })).rejects.toThrow("Consent");
    await expect(a.mutation(api.uploads.reserve, { problemId, kind: "photo" })).rejects.toThrow("Consent");
    await a.mutation(api.problems.setConsent, { problemId, consent: true });
    await t.run(ctx => ctx.db.insert("media", { owner: owner.subject, problemId, kind: "audio", state: "ready", expiresAt: Date.now() + 1000 }));
    await expect(a.mutation(api.problems.analyze, { problemId })).rejects.toThrow("transcript");
  });
  it("fails timed-out active jobs and rejects their late completion", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Dust", consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.mutation(internal.jobs.claim, { jobId });
    vi.setSystemTime(Date.now() + 181_000);
    await t.mutation(internal.jobs.expire, { jobId });
    expect((await a.query(api.problems.get, { problemId })).problem.state).toBe("failed");
    expect(await t.mutation(internal.jobs.completeAnalysis, {
      jobId, model: "fixture", result: { outcome: "referral", summary: "Late", evidence: [], questions: [], guideVersionIds: [] },
    })).toBe(false);
  });
  it("exposes missing provider credentials as failure, never false success", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const t = convexTest(schema, modules);
    await published(t);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Dust in accessible window track", consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.action(internal.ai.analyze, { jobId });
    const result = await a.query(api.problems.get, { problemId });
    expect(result.problem.state).toBe("failed");
    expect(result.problem.failure).toContain("OPENAI_API_KEY");
    expect(result.analysis).toBeNull();
  });
  it("routes hazardous text to referral without calling a paid provider", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Sparks from electrical wiring", consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.action(internal.ai.analyze, { jobId });
    expect((await a.query(api.problems.get, { problemId })).analysis?.result.outcome).toBe("referral");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("feedback accounting", () => {
  it("upserts one private response, counts updates once, and removes counts on deletion", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const guideVersionId = await published(t);
    const problemId = await a.mutation(api.problems.create, { text: "Dust", consent: true });
    const jobId = await a.mutation(api.problems.analyze, { problemId });
    await t.mutation(internal.jobs.claim, { jobId });
    await t.mutation(internal.jobs.completeAnalysis, {
      jobId, model: "fixture", result: { outcome: "suggestions", summary: "Potential match", evidence: [], questions: [], guideVersionIds: [guideVersionId] },
    });
    const first = await a.mutation(api.feedback.save, { problemId, guideVersionId, outcome: "worked", comment: "Private comment" });
    const second = await a.mutation(api.feedback.save, { problemId, guideVersionId, outcome: "partly", comment: "Updated private comment" });
    expect(second).toBe(first);
    const detail = await t.query(api.catalog.detail, { slug: "window-track" });
    expect(detail?.counts).toEqual({ worked: 0, partly: 1, not_worked: 0, total: 1 });
    expect(JSON.stringify(detail)).not.toContain("private comment");
    await expect(t.withIdentity(stranger).mutation(api.feedback.save, { problemId, guideVersionId, outcome: "worked" })).rejects.toThrow("not found");
    await a.mutation(api.problems.remove, { problemId });
    expect((await t.query(api.catalog.detail, { slug: "window-track" }))?.counts.total).toBe(0);
  });
});

describe("media validation", () => {
  it("removes abandoned storage without deleting referenced private content", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "Photo problem", consent: true });
    const kept = await t.run(ctx => ctx.storage.store(new Blob(["attached"])));
    const abandoned = await t.run(ctx => ctx.storage.store(new Blob(["abandoned"])));
    await t.run(ctx => ctx.db.insert("media", {
      owner: owner.subject, problemId, storageId: kept, kind: "photo", state: "ready", expiresAt: Date.now(),
    }));
    vi.setSystemTime(Date.now() + 86_400_001);
    await t.mutation(internal.cleanup.abandonedStorage, {});
    expect(await t.run(ctx => ctx.storage.get(abandoned))).toBeNull();
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(kept)))).toBe(true);
    await t.mutation(internal.cleanup.discardUnreferenced, { storageId: kept });
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(kept)))).toBe(true);
  });
  it("measures ordinary Opus WebM without duration metadata and handles unknown-sized clusters", () => {
    const text = (value: string) => Array.from(new TextEncoder().encode(value));
    const element = (id: number[], data: number[]) => [...id, 128 + data.length, ...data];
    const unknown = [1, 255, 255, 255, 255, 255, 255, 255];
    const header = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], text("webm")));
    const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], [
      ...element([0xd7], [1]), ...element([0x83], [2]), ...element([0x86], text("A_OPUS")),
    ]));
    const cluster = (time: number) => [
      0x1f, 0x43, 0xb6, 0x75, ...unknown,
      ...element([0xe7], [time >> 8, time & 255]),
      ...element([0xa3], [0x81, 0, 0, 0x80, 0x98, 0]),
    ];
    const recording = new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...unknown, ...tracks,
      ...Array.from({ length: 10 }, (_, i) => cluster(i * 1000)).flat()]);
    expect(webmDuration(recording)).toBe(9.02);
    expect(inspectMedia(recording, "audio")).toEqual({ mime: "audio/webm", durationSeconds: 9.02 });
    const long = new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...unknown, ...tracks, ...cluster(60_001)]);
    expect(() => inspectMedia(long, "audio")).toThrow("60 seconds");
  });
  it("authorizes private-file access and cleans up expired reservations", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(owner);
    const problemId = await a.mutation(api.problems.create, { text: "", consent: true });
    const reservation = await a.mutation(api.uploads.reserve, { problemId, kind: "photo" });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["private"])));
    await t.mutation(internal.uploads.claim, { reservationId: reservation.reservationId, storageId, owner: owner.subject });
    expect(await t.query(internal.uploads.privateFile, { mediaId: reservation.reservationId, owner: stranger.subject })).toBeNull();
    vi.setSystemTime(Date.now() + 601_000);
    await t.mutation(internal.uploads.cleanup, { reservationId: reservation.reservationId });
    expect(await t.run(ctx => ctx.storage.get(storageId))).toBeNull();
    expect((await a.query(api.problems.get, { problemId })).media).toEqual([]);
  });
  it("rejects disguised media, oversize photos, and unverifiable audio", () => {
    expect(() => inspectMedia(new TextEncoder().encode("<html>not a photograph</html>"), "photo")).toThrow();
    expect(() => inspectMedia(new Uint8Array(10 * 1024 * 1024 + 1), "photo")).toThrow();
    expect(() => inspectMedia(new Uint8Array(40), "audio")).toThrow();
  });
  it("measures WAV duration from its byte rate rather than a browser claim", () => {
    const bytes = new Uint8Array(44 + 16000);
    const view = new DataView(bytes.buffer);
    const write = (at: number, s: string) => bytes.set(new TextEncoder().encode(s), at);
    write(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); write(8, "WAVE");
    write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    view.setUint32(28, 16000, true); write(36, "data"); view.setUint32(40, 16000, true);
    expect(inspectMedia(bytes, "audio")).toEqual({ mime: "audio/wav", durationSeconds: 1 });
    view.setUint32(28, 1, true);
    expect(() => inspectMedia(bytes, "audio")).toThrow("PCM WAV");
    view.setUint32(28, 16000, true);
    const long = new Uint8Array(44 + 16000 * 61);
    long.set(bytes);
    const longView = new DataView(long.buffer);
    longView.setUint32(4, long.length - 8, true);
    longView.setUint32(40, long.length - 44, true);
    expect(() => inspectMedia(long, "audio")).toThrow("60 seconds");
  });
  it("rejects malformed GLBs", () => {
    expect(() => inspectGlb(new Uint8Array(50))).toThrow("header");
    expect(inspectGlb(fixtureGlb())).toEqual({ nodeNames: ["knob", "screw"], triangleCount: 2, mappingReady: true });
  });
});

describe("Tripo billing and stale work", () => {
  it("ingests a real-format provider fixture and requires complete human-reviewed part mappings", async () => {
    vi.stubEnv("TRIPO_API_KEY", "fixture-key-not-real");
    vi.stubEnv("TRIPO_MODEL_VERSION", "fixture-model");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "1");
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "fixture-task" } })));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0, data: { task_id: "fixture-task", status: "success", output: { pbr_model: "https://assets.tripo3d.ai/fixture.glb" } },
    })));
    fetch.mockResolvedValueOnce(new Response(fixtureGlb()));
    const t = convexTest(schema, modules);
    const a = t.withIdentity(reviewer);
    const { jobId, assemblyId } = await a.mutation(api.tripo.request, {
      prompt: "Illustrative cabinet knob with separate fixing", source: "Original editorial prompt", license: "Provider usage rights require review",
    });
    await t.action(internal.tripo.generate, { jobId });
    await t.action(internal.tripo.poll, { jobId, attempt: 0 });
    const asset = (await a.query(api.admin.assets, {}))[0];
    expect(asset.status).toBe("draft");
    expect(asset.generatedByTripo).toBe(true);
    expect(asset.storageId).toBeDefined();
    const parts = [
      { id: "knob", label: "Knob", description: "Illustrative knob", nodeNames: ["knob"], explodeOffset: [1, 0, 0] },
      { id: "screw", label: "Screw", description: "Illustrative screw", nodeNames: ["screw"], explodeOffset: [-1, 0, 0] },
    ];
    await expect(a.mutation(api.admin.reviewAssembly, {
      assemblyId, parts: [{ ...parts[0], nodeNames: ["invented"] }, parts[1]],
      geometryReviewed: true, applicabilityReviewed: true, rightsReviewed: true, mobileReviewed: true,
    })).rejects.toThrow("mesh nodes");
    await expect(a.mutation(api.admin.reviewAssembly, {
      assemblyId, parts: [{ ...parts[0], nodeNames: ["knob", "knob"] }, parts[1]],
      geometryReviewed: true, applicabilityReviewed: true, rightsReviewed: true, mobileReviewed: true,
    })).rejects.toThrow("unique mesh nodes");
    await a.mutation(api.admin.reviewAssembly, {
      assemblyId, parts, geometryReviewed: true, applicabilityReviewed: true, rightsReviewed: true, mobileReviewed: true,
    });
    expect((await a.query(api.admin.assets, {}))[0].status).toBe("reviewed");
    await expect(a.mutation(api.tripo.reserveCleanedUpload, { assemblyId })).rejects.toThrow("immutable");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("denies non-admin generation and requires an explicit cost budget", async () => {
    const t = convexTest(schema, modules);
    const args = { prompt: "Illustrative cabinet knob with a separate fixing", source: "Original editorial prompt", license: "Human reviewer must confirm provider output rights" };
    await expect(t.withIdentity(owner).mutation(api.tripo.request, args)).rejects.toThrow("Administrator");
    vi.stubEnv("TRIPO_API_KEY", "fixture-key-not-real");
    vi.stubEnv("TRIPO_MODEL_VERSION", "fixture-model");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "0");
    await expect(t.withIdentity(reviewer).mutation(api.tripo.request, args)).rejects.toThrow("TRIPO_DAILY_LIMIT");
  });
  it("submits a paid task at most once even when the outcome is ambiguous", async () => {
    vi.stubEnv("TRIPO_API_KEY", "fixture-key-not-real");
    vi.stubEnv("TRIPO_MODEL_VERSION", "fixture-model");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "1");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Fixture timeout"));
    const t = convexTest(schema, modules);
    const a = t.withIdentity(reviewer);
    const { jobId } = await a.mutation(api.tripo.request, {
      prompt: "Illustrative cabinet knob with separate fixing", source: "Original editorial prompt", license: "Provider usage rights require review",
    });
    await t.action(internal.tripo.generate, { jobId });
    await t.action(internal.tripo.generate, { jobId });
    expect(fetch).toHaveBeenCalledOnce();
    const jobs = await a.query(api.admin.jobs, {});
    expect(jobs[0].state).toBe("failed");
    expect(jobs[0].failure).toContain("outcome is unknown");
    expect((await a.query(api.admin.assets, {}))[0].generatedByTripo).toBe(false);
  });
  it("persists provider task IDs, deduplicates poll attempts, and refuses late ingestion", async () => {
    vi.stubEnv("TRIPO_API_KEY", "fixture-key-not-real");
    vi.stubEnv("TRIPO_MODEL_VERSION", "fixture-model");
    vi.stubEnv("TRIPO_DAILY_LIMIT", "1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { task_id: "fixture-task" } })));
    const t = convexTest(schema, modules);
    const a = t.withIdentity(reviewer);
    const { jobId, assemblyId } = await a.mutation(api.tripo.request, {
      prompt: "Illustrative cabinet knob with separate fixing", source: "Original editorial prompt", license: "Provider usage rights require review",
    });
    await t.action(internal.tripo.generate, { jobId });
    expect((await a.query(api.admin.jobs, {}))[0].providerTaskId).toBe("fixture-task");
    expect(await t.mutation(internal.tripo.pollClaim, { jobId, attempt: 0 })).toBe(true);
    expect(await t.mutation(internal.tripo.pollClaim, { jobId, attempt: 0 })).toBe(false);
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["fixture"])));
    vi.setSystemTime(Date.now() + 901_000);
    await t.mutation(internal.jobs.expire, { jobId });
    expect(await t.mutation(internal.tripo.ingest, { jobId, storageId, nodeNames: ["knob"], triangleCount: 1, mappingReady: true })).toBe(false);
    expect((await t.run(ctx => ctx.db.get(assemblyId)))?.storageId).toBeUndefined();
  });
});
