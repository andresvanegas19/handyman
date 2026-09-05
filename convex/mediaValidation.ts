import { ConvexError } from "convex/values";

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
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      if (offset + 8 + size > bytes.length) throw invalid();
      if (text(bytes, offset, 4) === "fmt " && size >= 16) rate = view.getUint32(offset + 16, true);
      if (text(bytes, offset, 4) === "data" && rate) duration = size / rate;
      offset += 8 + size + size % 2;
    }
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
    // WebM recorders must finalize the duration before upload. Unknown-duration streams are rejected.
    let scale = 1_000_000;
    let ticks = 0;
    for (let i = 4; i + 12 < bytes.length; i++) {
      if (bytes[i] === 0x2a && bytes[i + 1] === 0xd7 && bytes[i + 2] === 0xb1) {
        const size = bytes[i + 3] & 0x7f;
        if (size >= 1 && size <= 4 && (bytes[i + 3] & 0x80)) {
          scale = 0;
          for (let j = 0; j < size; j++) scale = scale * 256 + bytes[i + 4 + j];
        }
      }
      if (bytes[i] === 0x44 && bytes[i + 1] === 0x89) {
        const size = bytes[i + 2] & 0x7f;
        if (size === 4) ticks = view.getFloat32(i + 3);
        if (size === 8) ticks = view.getFloat64(i + 3);
      }
    }
    duration = ticks * scale / 1_000_000_000;
  } else throw invalid();
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new ConvexError("Audio must have verifiable duration metadata and be no longer than 60 seconds. Use a finalized WAV or MP4 file.");
  return { mime, durationSeconds: duration };
}
