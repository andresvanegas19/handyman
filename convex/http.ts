import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { guestOwner } from "./lib";

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({
  path: "/repair-scene", method: "GET",
  handler: httpAction(async (ctx, request) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return new Response("Authentication required", { status: 401 });
    const sceneId = new URL(request.url).searchParams.get("id");
    if (!sceneId) return new Response("Not found", { status: 404 });
    const file = await ctx.runQuery(internal.repairPipeline.privateSceneFile, { sceneId, owner: guestOwner(user.subject) });
    if (!file) return new Response("Not found", { status: 404 });
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    return new Response(blob, { headers: {
      "Content-Type": "model/gltf-binary", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Disposition": 'attachment; filename="repair-scene.glb"', ...cors(request),
    } });
  }),
});
http.route({
  path: "/repair-scene", method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => new Response(null, {
    status: 204, headers: { ...cors(request), "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization" },
  })),
});
http.route({
  path: "/scene", method: "GET",
  handler: httpAction(async (ctx, request) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return new Response("Authentication required", { status: 401 });
    const sceneId = new URL(request.url).searchParams.get("id");
    if (!sceneId) return new Response("Not found", { status: 404 });
    const file = await ctx.runQuery(internal.tripo.privateSceneFile, { sceneId, owner: guestOwner(user.subject) });
    if (!file) return new Response("Not found", { status: 404 });
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    return new Response(blob, {
      headers: {
        "Content-Type": "model/gltf-binary", "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff", "Content-Disposition": 'attachment; filename="repair-context.glb"',
        ...cors(request),
      },
    });
  }),
});
http.route({
  path: "/scene", method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => new Response(null, {
    status: 204, headers: { ...cors(request), "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization" },
  })),
});
http.route({
  path: "/media", method: "GET",
  handler: httpAction(async (ctx, request) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return new Response("Authentication required", { status: 401 });
    const mediaId = new URL(request.url).searchParams.get("id");
    if (!mediaId) return new Response("Not found", { status: 404 });
    const file = await ctx.runQuery(internal.uploads.privateFile, { mediaId, owner: guestOwner(user.subject) });
    if (!file) return new Response("Not found", { status: 404 });
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    return new Response(blob, {
      headers: {
        "Content-Type": file.mime ?? "application/octet-stream",
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline", ...cors(request),
      },
    });
  }),
});
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (process.env.APP_ORIGINS ?? "").split(",").map(s => s.trim());
  return allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}
http.route({
  path: "/media", method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => new Response(null, {
    status: 204, headers: { ...cors(request), "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization" },
  })),
});
export default http;
