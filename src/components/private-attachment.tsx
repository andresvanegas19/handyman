"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { FileAudio, ImageIcon } from "lucide-react";
import { messageFromError } from "@/lib/media";
import { privateFileUrl } from "@/lib/private-file";
import type { Id } from "../../convex/_generated/dataModel";

function deliveryUrl(mediaId: string): URL {
  return privateFileUrl("/media", mediaId);
}

export default function PrivateAttachment({ media }: { media: { _id: Id<"media">; kind: "photo" | "audio"; state: "ready" | "reserved"; durationSeconds?: number } }) {
  const token = useAuthToken();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const open = async () => {
    if (busy) return;
    setBusy(true); setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!token) throw new Error("Your browser session expired. Refresh the page to reconnect.");
      const response = await fetch(deliveryUrl(media._id), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("This private file could not be opened. Check your session and try again.");
      const blob = await response.blob();
      if (!controller.signal.aborted) setUrl(URL.createObjectURL(blob));
    } catch (e) { if (!controller.signal.aborted) setError(messageFromError(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <div style={{flex:1,minWidth:0}}>
    <span className="small">{media.kind === "audio" ? <FileAudio size={15} style={{verticalAlign:"middle",marginRight:8}}/> : <ImageIcon size={15} style={{verticalAlign:"middle",marginRight:8}}/>}{media.kind === "audio" ? "Voice note" : "Photo"} · {media.state === "ready" ? "Stored privately" : "Upload incomplete"}{media.durationSeconds ? ` · ${Math.ceil(media.durationSeconds)}s` : ""}</span>
    {media.state === "ready" && !url && <button className="text-link" style={{display:"block",marginTop:6,padding:0,border:0,background:"none"}} disabled={busy} onClick={() => void open()}>{busy ? "Opening private file…" : media.kind === "photo" ? "View photo privately" : "Play voice note"}</button>}
    {url && <div style={{marginTop:13}}>{media.kind === "photo" ? <Image src={url} width={260} height={190} unoptimized alt="Your private repair attachment" style={{maxWidth:"100%",height:"auto",borderRadius:8}}/> : <audio src={url} controls style={{maxWidth:"100%"}}/>}<button className="text-link" style={{display:"block",border:0,background:"none",padding:0,fontSize:11}} onClick={()=>setUrl("")}>Close preview</button></div>}
    {error && <p className="small" style={{color:"#923f2f",margin:"8px 0 0"}} role="alert">{error}</p>}
  </div>;
}
