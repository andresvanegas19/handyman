import { AUDIO_TYPES, INPUT_LIMITS, PHOTO_TYPES } from "./domain";

export function validatePhoto(file: File): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return "Choose a JPEG, PNG, or WebP photo.";
  if (!file.size || file.size > INPUT_LIMITS.photoBytes) return "Each photo must be between 1 byte and 10 MB.";
  return null;
}

export function validateAudio(file: File): string | null {
  if (!(AUDIO_TYPES as readonly string[]).includes(file.type.split(";")[0])) return "Choose a WebM, MP4, MP3, WAV, or Ogg audio file.";
  if (!file.size || file.size > INPUT_LIMITS.audioBytes) return "Audio must be between 1 byte and 15 MB.";
  return null;
}

export function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const cleanup = () => { clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Could not check the clip length. Try another audio file or describe the problem in text.")); }, 10000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error("We could not verify this clip's length. Try an MP3 or WAV file."));
      else if (duration > INPUT_LIMITS.audioSeconds) reject(new Error("Keep your audio clip to 60 seconds or less."));
      else resolve(duration);
    };
    audio.onerror = () => { cleanup(); reject(new Error("This audio file could not be read. Try a different format or use text.")); };
    audio.src = url;
  });
}

export function messageFromError(error: unknown): string {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message.replace(/\[CONVEX [^\]]+\]\s*/g, "").slice(0, 500) : "Something went wrong. Please try again.";
}

export function encodeMonoWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const sample = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true); }
  return buffer;
}

async function preserveSupportedAudio(file: File, recordedDuration?: number): Promise<{ file: File; duration: number }> {
  if (!["audio/wav", "audio/mp4", "audio/webm"].includes(file.type)) throw new Error("This browser could not prepare your audio. Try WAV, MP4, WebM, or a text description.");
  if (file.type === "audio/webm" && recordedDuration !== undefined) {
    if (!Number.isFinite(recordedDuration) || recordedDuration <= 0 || recordedDuration > INPUT_LIMITS.audioSeconds) throw new Error("Keep your audio clip to 60 seconds or less.");
    return { file, duration: recordedDuration };
  }
  return { file, duration: await readAudioDuration(file) };
}

export async function normalizeAudio(file: File, recordedDuration?: number): Promise<{ file: File; duration: number }> {
  const invalid = validateAudio(file);
  if (invalid) throw new Error(invalid);
  if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") {
    return preserveSupportedAudio(file, recordedDuration);
  }
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > INPUT_LIMITS.audioSeconds) throw new Error("Keep your audio clip to 60 seconds or less.");
    const sampleRate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    const mono = await offline.startRendering();
    const prepared = new File([encodeMonoWav(mono.getChannelData(0), sampleRate)], `${file.name.replace(/\.[^.]+$/, "")}.wav`, { type: "audio/wav" });
    return { file: prepared, duration: mono.length / sampleRate };
  } catch (error) {
    if (error instanceof Error && error.message.includes("60 seconds")) throw error;
    return preserveSupportedAudio(file, recordedDuration);
  } finally { await context.close(); }
}
