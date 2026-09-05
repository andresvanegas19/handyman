import { privateFileUrl } from "./private-file";
import { MAX_GLB_BYTES, validateSelfContainedGlb } from "@/components/viewer/model-utils";

export async function fetchPrivateRepairModel(sceneId: string, token: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(privateFileUrl("/repair-scene", sceneId), {
    headers: { Authorization: `Bearer ${token}` }, signal, cache: "no-store",
    credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Your private model authorization expired. Reconnect your browser session and retry."
    : "The private model is unavailable. Retry when your connection and repair are available.");
  if (Number(response.headers.get("content-length")) > MAX_GLB_BYTES) throw new Error("The model exceeds the 10 MB viewer limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The private model response could not be read.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GLB_BYTES) throw new Error("The model exceeds the 10 MB viewer limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  signal.throwIfAborted();
  validateSelfContainedGlb(bytes.buffer);
  return new Blob([bytes], { type: "model/gltf-binary" });
}
