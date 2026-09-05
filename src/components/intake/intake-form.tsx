"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, CircleStop, FileAudio, Info, LoaderCircle, Mic, Plus, X } from "lucide-react";
import { INPUT_LIMITS } from "@/lib/domain";
import { messageFromError, normalizeAudio, validateAudio, validatePhoto } from "@/lib/media";
import { SetupNotice } from "../service-notice";
import styles from "./intake-form.module.css";

type LocalPhoto = { file: File; url: string };
type LocalAudio = { file: File; url: string; duration: number };
export type IntakeSubmission = { text: string; photos: File[]; audio?: { file: File; duration: number }; consent: boolean };

export default function IntakeForm({ onSubmit, busy = false, status = "", storageMode = "cloud", workflow = "legacy" }: { onSubmit?: (data: IntakeSubmission) => Promise<void>; busy?: boolean; status?: string; storageMode?: "cloud" | "temporary"; workflow?: "legacy" | "visual" }) {
  const visual = workflow === "visual" && storageMode === "cloud";
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [audio, setAudio] = useState<LocalAudio | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [reading, setReading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const urls = useRef(new Set<string>());
  const photoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const attachmentPicker = useRef<HTMLDivElement>(null);
  const attachmentToggle = useRef<HTMLButtonElement>(null);
  const releaseUrl = (url: string) => { URL.revokeObjectURL(url); urls.current.delete(url); };
  const makeUrl = (file: File) => { const url = URL.createObjectURL(file); urls.current.add(url); return url; };

  useEffect(() => {
    mounted.current = true;
    const currentUrls = urls.current;
    const input = new URLSearchParams(window.location.search).get("input");
    if (input === "text") textInput.current?.focus();
    if (input === "photo") attachmentToggle.current?.focus();
    if (input === "audio") document.getElementById("audio-trigger")?.focus();
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
      currentUrls.forEach(url => URL.revokeObjectURL(url));
      currentUrls.clear();
    };
  }, []);

  useEffect(() => {
    const input = textInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (!attachmentsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !attachmentPicker.current?.contains(event.target)) setAttachmentsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAttachmentsOpen(false);
        attachmentToggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [attachmentsOpen]);

  const replaceAudio = (file: File, duration: number) => {
    if (audio) releaseUrl(audio.url);
    setAudio({ file, duration, url: makeUrl(file) });
  };
  const addPhotos = (files: FileList | null) => {
    setError("");
    if (!files) return;
    if (files.length + photos.length > INPUT_LIMITS.photos) { setError("You can add up to three photos. Remove one before adding another."); return; }
    const incoming = Array.from(files);
    const invalid = incoming.map(validatePhoto).find(Boolean);
    if (invalid) { setError(invalid); return; }
    setPhotos(previous => [...previous, ...incoming.map(file => ({ file, url: makeUrl(file) }))]);
  };
  const addAudio = async (file?: File) => {
    setError("");
    if (!file) return;
    const invalid = validateAudio(file);
    if (invalid) { setError(invalid); return; }
    setReading(true);
    try { const prepared = await normalizeAudio(file); if (mounted.current) replaceAudio(prepared.file, prepared.duration); }
    catch (e) { if (mounted.current) setError(messageFromError(e)); }
    finally { if (mounted.current) setReading(false); }
  };
  const stopRecording = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    if (timer.current) clearInterval(timer.current);
    setRecording(false);
  };
  const startRecording = async () => {
    setError("");
    if (starting || recording) return;
    if (window.isSecureContext === false) { setError("Live recording needs HTTPS. On a phone using this Wi-Fi preview, upload an audio file or type your description instead."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Recording isn't supported in this browser. Upload an audio file or use text instead."); return; }
    setStarting(true);
    try {
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { setError("This browser can't record a supported format. Upload a clip or type your description instead."); return; }
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { mediaStream.getTracks().forEach(track => track.stop()); return; }
      stream.current = mediaStream;
      const mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
      recorder.current = mediaRecorder;
      const chunks: Blob[] = [];
      let byteCount = 0;
      const start = Date.now();
      let exceeded = false;
      mediaRecorder.ondataavailable = event => {
        byteCount += event.data.size;
        if (byteCount > INPUT_LIMITS.audioBytes) { exceeded = true; if (mediaRecorder.state === "recording") mediaRecorder.stop(); }
        else chunks.push(event.data);
      };
      mediaRecorder.onerror = () => { stopRecording(); setError("Recording was interrupted. Please try again or upload a file."); };
      mediaRecorder.onstop = async () => {
        mediaStream.getTracks().forEach(track => track.stop());
        if (timer.current) clearInterval(timer.current);
        if (!mounted.current) return;
        setRecording(false);
        if (exceeded) { setError("Recording exceeded 15 MB. Please make a shorter clip."); return; }
        const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
        const file = new File(chunks, `home-repair-note.${extension}`, { type: mimeType.split(";")[0] });
        const invalid = validateAudio(file);
        if (invalid) { setError(invalid); return; }
        setReading(true);
        try { const prepared = await normalizeAudio(file, (Date.now() - start) / 1000); if (mounted.current) replaceAudio(prepared.file, prepared.duration); }
        catch (e) { if (mounted.current) setError(messageFromError(e)); }
        finally { if (mounted.current) setReading(false); }
      };
      setSeconds(0);
      setRecording(true);
      mediaRecorder.start(250);
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        setSeconds(elapsed);
        if (elapsed >= INPUT_LIMITS.audioSeconds - 1) stopRecording();
      }, 250);
    } catch { stream.current?.getTracks().forEach(track=>track.stop()); setError("Microphone access wasn't available. Check browser permissions, upload a voice note, or type instead."); }
    finally { if (mounted.current) setStarting(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onSubmit) return;
    setError("");
    if (visual && (!text.trim() || !photos.length)) { setError("Add both a written description and a photo to start your visual repair."); return; }
    if (!text.trim() && !photos.length && !audio) { setError("Add a few words, a photo, or a voice note to get started."); return; }
    if (!consent) { setError("Please review and accept the processing consent first."); return; }
    try { await onSubmit({ text: text.trim(), photos: photos.map(p => p.file), audio: audio ? { file: audio.file, duration: audio.duration } : undefined, consent }); }
    catch (e) { setError(messageFromError(e)); }
  };

  const hasInput = visual ? Boolean(text.trim() && photos.length) : Boolean(text.trim() || photos.length || audio);
  const canSubmit = Boolean(onSubmit && !busy && !recording && !reading && !starting && consent && hasInput);
  const submitLabel = busy ? "Saving your repair…" : storageMode === "temporary" ? "Save temporary repair" : visual ? "Start visual repair" : audio ? "Upload & transcribe" : "Find my next step";
  const recordingLabel = recording ? `Stop · ${seconds}s` : starting ? "Opening microphone…" : "Record a voice note";

  return <div className={styles.intake}>
    <form onSubmit={submit} aria-label="Describe your repair">
      <input ref={photoInput} id="photos" aria-label="Choose photos" tabIndex={-1} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={e => { addPhotos(e.target.files); e.target.value = ""; }}/>
      {!visual && <input ref={audioInput} id="audio" aria-label="Choose an audio file" tabIndex={-1} className="file-input" type="file" accept="audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg" disabled={busy || recording || reading || starting} onChange={e => { void addAudio(e.target.files?.[0]); e.target.value = ""; }}/>}

      {photos.length > 0 && <div className={styles.photos}>{photos.map((photo, i) => <div className={styles.photo} key={photo.url}>
        <Image src={photo.url} alt={`Your selected photo ${i + 1}`} width={96} height={96} unoptimized/>
        <button type="button" disabled={busy} aria-label={`Remove photo ${i + 1}`} onClick={() => { releaseUrl(photo.url); setPhotos(photos.filter(p => p.url !== photo.url)); }}><X size={15}/></button>
      </div>)}</div>}
      {visual && photos.length > 1 && <div className="field"><label htmlFor="source-photo">Photo for automatic 3D generation</label><select id="source-photo" disabled={busy} value={photos[0].url} onChange={event => {
        const selected = photos.find(photo => photo.url === event.target.value);
        if (selected) setPhotos([selected, ...photos.filter(photo => photo !== selected)]);
      }}>{photos.map(photo => <option key={photo.url} value={photo.url}>{photo.file.name}</option>)}</select></div>}

      <div className={styles.composer}>
        <div ref={attachmentPicker} className={styles.attachmentPicker}>
          <button ref={attachmentToggle} className={styles.iconButton} type="button" aria-label="Add attachments" title="Add attachments" aria-expanded={attachmentsOpen} aria-controls="attachment-options" disabled={busy} onClick={() => setAttachmentsOpen(!attachmentsOpen)}><Plus size={26}/></button>
          {attachmentsOpen && <div id="attachment-options" className={styles.attachmentOptions} role="group" aria-label="Attachment options">
            <button type="button" disabled={busy || photos.length >= INPUT_LIMITS.photos} onClick={() => { setAttachmentsOpen(false); photoInput.current?.click(); }}><Camera size={20}/><span>Add photos<small>Up to 3 · JPEG, PNG, WebP · 10 MB each</small></span></button>
            {!visual && <button type="button" disabled={busy || recording || reading || starting} onClick={() => { setAttachmentsOpen(false); audioInput.current?.click(); }}><FileAudio size={20}/><span>Upload audio<small>One clip · 60 seconds · 15 MB max</small></span></button>}
          </div>}
        </div>
        <label className="visually-hidden" htmlFor="description">What&apos;s happening?</label>
        <textarea ref={textInput} id="description" className={styles.input} rows={1} placeholder="Ask about a repair" aria-describedby="composer-help" maxLength={INPUT_LIMITS.text} value={text} onChange={e => setText(e.target.value)} disabled={busy} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSubmit) e.currentTarget.form?.requestSubmit();
          }
        }}/>
        <div className={styles.actions}>
          {!visual && <button id="audio-trigger" type="button" className={`${styles.iconButton} ${recording ? styles.recording : ""}`} aria-label={recordingLabel} title={recordingLabel} disabled={busy || reading || starting} onClick={recording ? stopRecording : startRecording}>{starting ? <LoaderCircle className={styles.spinner} size={23}/> : recording ? <CircleStop size={25}/> : <Mic size={25}/>}</button>}
          <button className={styles.sendButton} type="submit" aria-label={submitLabel} title={submitLabel} disabled={!canSubmit}>{busy ? <LoaderCircle className={styles.spinner} size={25}/> : <ArrowUp size={27}/>}</button>
        </div>
      </div>

      <div id="composer-help" className={styles.hint}>
        <span>{visual ? "Required: a written description and a photo. The first photo is used for 3D." : recording ? `Recording · ${seconds}s / 60s. Tap stop when you're done.` : "A few words, a photo, or a voice note."}</span>
        {text.length > 0 && <span>{text.length.toLocaleString()} / 4,000</span>}
      </div>
      {starting && <p className={styles.status} role="status">Allow microphone access in your browser to start recording.</p>}
      {reading && <p className={styles.status} role="status">Checking your clip and preparing audio…</p>}
      {audio && <div className={styles.audioPreview}>
        <div className={styles.audioInfo}><span><FileAudio size={17}/>{audio.file.name} · {Math.ceil(audio.duration)}s</span><button className={styles.iconButton} type="button" disabled={busy || recording || starting} aria-label="Remove audio" onClick={() => { releaseUrl(audio.url); setAudio(null); }}><X size={18}/></button></div>
        <audio controls src={audio.url}/>
        <p>{storageMode === "temporary" ? "Audio stays in memory on this device. No transcription is performed; refresh clears the recording." : <>{audio.file.type === "audio/wav" ? "Prepared as WAV for reliable transcription." : "Original supported audio retained because this browser could not convert it to WAV. The server will verify its format and length."} After upload, you&apos;ll review and edit a transcript before analysis.</>}</p>
      </div>}
      {(visual || hasInput) && <label className={styles.consent}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}/><span>{storageMode === "temporary" ? "I understand that text is saved only in this tab, and photos/audio clear on refresh. Anyone using this browser tab can see them. Nothing is sent to Convex or AI in temporary mode." : visual ? "I consent to private storage in Convex; sending my photo and description to OpenRouter and its underlying model provider for recognition and planning; sanitized product/problem searches through Firecrawl; and automatic paid Tripo 3D generation and segmentation when needed, within the service’s spending limits. I have permission to share these files and have removed personal details. Provider retention policies apply. Results remain private AI drafts, not human-reviewed guidance." : "I agree to private storage of my submission in Convex and processing by OpenAI for transcription and analysis. I have removed personal details and have permission to share these files."} <Link href="/privacy">Privacy & deletion details</Link>.</span></label>}
      {error && <div className={styles.error} role="alert"><Info size={18}/><p>{error}</p></div>}
      {!onSubmit && <p className={styles.status}>Available when services are configured.</p>}
      {status && <p className={styles.status} role="status">{status}</p>}
    </form>
    <p className={styles.safety}>For small home repairs. Gas, smoke, sparks, or major leaks? <Link href="/privacy#safety">Stop and get qualified help.</Link></p>
    <div className={styles.setup}><SetupNotice/></div>
  </div>;
}
