import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPrivateRepairModel } from "./private-model";
import { MAX_GLB_BYTES } from "@/components/viewer/model-utils";
import { privateFileUrl } from "./private-file";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("private mapped model delivery", () => {
  it("uses the authenticated repair-scene route and encodes its identifier", () => {
    expect(privateFileUrl("/repair-scene", "owner scene&x").href).toBe("https://test.convex.site/repair-scene?id=owner+scene%26x");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://custom.example");
    expect(privateFileUrl("/repair-scene", "scene").href).toBe("https://custom.example/repair-scene?id=scene");
  });
  it("fails explicitly when private delivery has no configured site", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://localhost:3210");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(fetchPrivateRepairModel("scene", "token", new AbortController().signal)).rejects.toThrow("site URL configuration");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an oversized response before reading the body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("large", { headers: { "content-length": String(MAX_GLB_BYTES + 1) } })));
    await expect(fetchPrivateRepairModel("scene", "token", new AbortController().signal)).rejects.toThrow("10 MB viewer limit");
  });
  it("bounds streaming responses even if no content-length was provided", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_GLB_BYTES + 1)); },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(fetchPrivateRepairModel("scene", "token", new AbortController().signal)).rejects.toThrow("10 MB viewer limit");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects a missing body rather than displaying an indefinite loading state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    await expect(fetchPrivateRepairModel("scene", "token", new AbortController().signal)).rejects.toThrow("response could not be read");
  });
  it("does not accept a late response after authorization cleanup aborts its request", async () => {
    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("late response")));
    await expect(fetchPrivateRepairModel("scene", "token", abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
