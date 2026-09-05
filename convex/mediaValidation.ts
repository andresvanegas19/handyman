import { ConvexError } from "convex/values";
import { webmDuration } from "./webm";

const invalid = () => new ConvexError("Unsupported or invalid media. Use a JPEG/PNG/WebP photo, or a WAV/MP4/WebM audio file with duration metadata.");
function text(bytes: Uint8Array, start: number, length: number) {
  return new TextDecoder().decode(bytes.subarray(start, start + length));
}
export function inspectMedia(bytes: Uint8Array, kind: "photo" | "audio") {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (kind === "photo") {
    if (bytes.length < 16 || bytes.length > 10 * 1024 * 1024) throw invalid();
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg" };
    if (text(bytes, 1, 3) === "PNG" && view.getUint32(0) === 0x89504e47 && text(bytes, 12, 4) === "IHDR") return { mime: "image/png" };
    if (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 4) === "WEBP") return { mime: "image/webp" };
    throw invalid();
  }
  if (bytes.length < 32 || bytes.length > 15 * 1024 * 1024) throw invalid();
  let mime: string;
  let duration = 0;
  if (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 4) === "WAVE") {
    mime = "audio/wav";
    let rate = 0;
    let blockAlign = 0;
    let dataBytes = 0;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      if (offset + 8 + size > bytes.length) throw invalid();
      if (text(bytes, offset, 4) === "fmt " && size >= 16) {
        const format = view.getUint16(offset + 8, true);
        const channels = view.getUint16(offset + 10, true);
        const sampleRate = view.getUint32(offset + 12, true);
        const claimedRate = view.getUint32(offset + 16, true);
        const alignment = view.getUint16(offset + 20, true);
        const bits = view.getUint16(offset + 22, true);
        if (rate || format !== 1 || ![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 96000 ||
          ![8, 16, 24, 32].includes(bits) || alignment !== channels * bits / 8 || claimedRate !== sampleRate * alignment) {
          throw new ConvexError("Use a valid mono or stereo PCM WAV recording.");
        }
        blockAlign = alignment;
        rate = sampleRate * blockAlign;
      }
      if (text(bytes, offset, 4) === "data") {
        if (!rate || size % blockAlign !== 0) throw invalid();
        dataBytes += size;
      }
      offset += 8 + size + size % 2;
    }
    duration = dataBytes / rate;
  } else if (text(bytes, 4, 4) === "ftyp") {
    mime = "audio/mp4";
    function boxes(start: number, end: number) {
      for (let offset = start; offset + 8 <= end;) {
        const size = view.getUint32(offset);
        if (size < 8 || offset + size > end) throw invalid();
        const type = text(bytes, offset + 4, 4);
        if (type === "moov") boxes(offset + 8, offset + size);
        if (type === "mvhd" && size >= 32) {
          const version = bytes[offset + 8];
          const base = offset + (version === 1 ? 28 : 20);
          if (base + (version === 1 ? 12 : 8) > offset + size) throw invalid();
          const scale = view.getUint32(base);
          const ticks = version === 1 ? Number(view.getBigUint64(base + 4)) : view.getUint32(base + 4);
          if (scale) duration = ticks / scale;
        }
        offset += size;
      }
    }
    boxes(0, bytes.length);
  } else if (view.getUint32(0) === 0x1a45dfa3) {
    mime = "audio/webm";
    try { duration = webmDuration(bytes); } catch { throw invalid(); }
  } else throw invalid();
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new ConvexError("Audio must have verifiable duration metadata and be no longer than 60 seconds. Use a finalized WAV or MP4 file.");
  return { mime, durationSeconds: duration };
}
