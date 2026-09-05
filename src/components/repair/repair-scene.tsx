"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { messageFromError } from "@/lib/media";
import { privateFileUrl } from "@/lib/private-file";
import PrivateAttachment from "../private-attachment";

const SceneCanvas = dynamic(() => import("../viewer/SceneCanvas"), { ssr: false });

class SceneBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError("3D is unavailable in this browser. You can still download the GLB for Blender."); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function RepairScene({ problemId, photos }: {
  problemId: Id<"problems">;
  photos: { _id: Id<"media">; kind: "photo" | "audio"; state: "ready" | "reserved" }[];
}) {
  const data = useQuery(api.tripo.scene, { problemId });
  const request = useMutation(api.tripo.requestScene);
  const [photoId, setPhotoId] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const readyPhotos = photos.filter(photo => photo.kind === "photo" && photo.state === "ready");
  const selected = readyPhotos.find(photo => photo._id === photoId) ?? readyPhotos[0];
  if (!data) return <p role="status">Loading 3D availability...</p>;
  const scene = data.scene;
  const pending = scene?.state === "queued" || scene?.state === "running";
  return <section className="workspace-section">
    <span className="eyebrow">PHOTO TO SPATIAL CONTEXT</span>
    <h2>Your repair, in 3D.</h2>
    <p>Tripo creates an approximate model from one selected photo, not a measured reconstruction. Use a close-up of the relevant panel and component, not the entire room. Hidden parts, shaft shape, fit, and dimensions cannot be verified from a generated model.</p>
    {!data.configured && <p className="notice">3D generation is not configured. An administrator must set the Tripo API key, model version, and paid daily limit in Convex.</p>}
    {!data.eligible && <p className="notice">3D generation is locked until analysis establishes a low-risk match to a reviewed guide. Unsafe, uncertain, and unsupported repairs must not proceed to DIY instructions.</p>}
    {scene?.failure && <p role="alert" className="notice notice-error">{scene.failure} Before retrying, have the administrator check the Tripo dashboard to avoid duplicate charges.</p>}
    {pending && <p role="status">Tripo generation is {scene.state}. You can leave this page; progress is saved. Submission is not automatically retried.</p>}
    {data.eligible && !pending && !scene?.ready && <>
      {!readyPhotos.length ? <p>Add a close-up photo to a new repair before requesting a 3D model.</p> : <>
        <div className="field"><label htmlFor="scene-photo">Source photo</label><select id="scene-photo" value={selected?._id ?? ""} disabled={busy} onChange={event => { setPhotoId(event.target.value); setConsent(false); }}>
          {readyPhotos.map((photo, index) => <option key={photo._id} value={photo._id}>Photo {index + 1}</option>)}
        </select></div>
        {selected && <PrivateAttachment key={selected._id} media={selected}/>}
        <label className="consent-label"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)}/><span>I have permission to send this photo to Tripo for paid 3D generation. The result is unreviewed visual context, not repair guidance. Provider retention policies apply.</span></label>
        <button className="button" disabled={!consent || !data.configured || busy} onClick={async () => {
          if (!selected) { setError("Choose a ready source photo before generating a model."); return; }
          setBusy(true); setError("");
          try { await request({ problemId, photoId: selected._id, consent }); }
          catch (error) { setError(messageFromError(error)); }
          finally { setBusy(false); }
        }}>{busy ? "Submitting..." : scene ? "Retry Tripo generation" : "Generate 3D with Tripo"}</button>
      </>}
    </>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {scene?.ready && <PrivateScene key={scene._id} sceneId={scene._id}/>}
  </section>;
}

function PrivateScene({ sceneId }: { sceneId: Id<"repairScenes"> }) {
  const token = useAuthToken();
  return <PrivateScenePreview key={token ?? "expired"} sceneId={sceneId} token={token}/>;
}

function PrivateScenePreview({ sceneId, token }: { sceneId: Id<"repairScenes">; token: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const reportError = useCallback((message: string) => setError(message), []);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const open = async () => {
    setBusy(true); setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (!token) throw new Error("Your browser session expired. Refresh to reconnect.");
      const response = await fetch(privateFileUrl("/scene", sceneId), {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45_000)]),
      });
      if (!response.ok) throw new Error("The private scene is unavailable. Recheck your session and the repair analysis.");
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error("The scene exceeds the 10 MB limit.");
      if (!abort.signal.aborted) setUrl(URL.createObjectURL(blob));
    } catch (error) { if (!abort.signal.aborted) setError(messageFromError(error)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  return <div>
    <p className="notice" role="note">Unreviewed Tripo output. Do not use it to infer internal parts, repair motions, or safe force. No automatic part mapping or disassembly instructions are generated.</p>
    {!url && <button className="button button-secondary" disabled={busy} onClick={() => void open()}>{busy ? "Opening private model..." : "Open private 3D model"}</button>}
    {url && <>
      <SceneBoundary key={url} onError={reportError}><SceneCanvas url={url} onError={reportError}/></SceneBoundary>
      <p className="small">Drag to rotate; scroll or pinch to zoom. In Blender, use File &gt; Import &gt; glTF 2.0 to inspect the downloaded model. Separate and label parts manually before review.</p>
      <a className="button button-secondary" href={url} download="repair-context.glb">Download GLB for Blender</a>
      <button className="text-link" onClick={() => { setUrl(null); setError(""); }}>Close model</button>
    </>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
  </div>;
}
