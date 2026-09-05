"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { isConnected, visualRepairEnabled } from "@/lib/config";
import IntakeForm, { type IntakeSubmission } from "./intake-form";
import AuthGate from "../auth-gate";
import { TemporaryIntake } from "../temporary-repairs";

export default function Intake() { return isConnected ? <AuthGate>{visualRepairEnabled ? <ConnectedIntake/> : <AuthenticatedIntake/>}</AuthGate> : <TemporaryIntake/>; }
function ConnectedIntake() {
  const [legacy, setLegacy] = useState(false);
  useEffect(() => { setLegacy(new URLSearchParams(window.location.search).get("input") === "audio"); }, []);
  return <>{legacy ? <><p>Legacy audio and text repair · review your transcript before analysis.</p><AuthenticatedIntake/><Link href="/problems/new" onClick={() => setLegacy(false)}>Use photo + written visual repair instead</Link></> : <><VisualIntake/><Link href="/problems/new?input=audio" onClick={() => setLegacy(true)}>Use the separate legacy audio workflow</Link></>}</>;
}

export function VisualIntake() {
  const create = useMutation(api.problems.create);
  const remove = useMutation(api.problems.remove);
  const reserve = useMutation(api.uploads.reserve);
  const finalize = useAction(api.uploads.finalize);
  const start = useMutation(api.repairPipeline.start);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const active = useRef(false);
  const incomplete = useRef<Id<"problems"> | null>(null);
  const submit = async (data: IntakeSubmission) => {
    if (active.current) return;
    if (!data.text.trim() || !data.photos.length || !data.consent || data.audio) throw new Error("A photo, written description, and provider consent are required.");
    active.current = true;
    setBusy(true);
    let problemId: Id<"problems"> | undefined;
    let uploaded = false;
    try {
      if (incomplete.current) {
        await remove({ problemId: incomplete.current });
        incomplete.current = null;
      }
      setStatus("Saving your private photo and written description…");
      problemId = await create({ text: data.text.trim(), consent: data.consent, workflow: "visual" });
      incomplete.current = problemId;
      for (const [index, file] of data.photos.entries()) {
        setStatus(`Uploading photo ${index + 1} of ${data.photos.length}…`);
        const reservation = await reserve({ problemId, kind: "photo" });
        const response = await fetch(reservation.uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file, signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error("The upload was interrupted. Your local inputs are still here.");
        const result: { storageId?: Id<"_storage"> } = await response.json();
        if (!result.storageId) throw new Error("The upload did not return a file reference.");
        await finalize({ reservationId: reservation.reservationId, storageId: result.storageId });
      }
      uploaded = true;
      incomplete.current = null;
      setStatus("Starting automatic recognition, research, and mapped 3D preparation…");
      await start({ problemId });
      router.push(`/problems/${problemId}`);
    } catch (error) {
      if (uploaded && problemId) {
        // A lost start response must not delete an accepted run or cause a second paid submission.
        router.push(`/problems/${problemId}`);
        return;
      }
      setStatus("Your local inputs are still here. Review the error and try again.");
      if (problemId) {
        try { await remove({ problemId }); incomplete.current = null; }
        catch { setStatus("An incomplete private draft remains in My repairs. Retrying will clean it up before creating another."); }
      }
      throw error;
    } finally { active.current = false; setBusy(false); }
  };
  return <IntakeForm workflow="visual" onSubmit={submit} busy={busy} status={status}/>;
}
function AuthenticatedIntake() {
  const create = useMutation(api.problems.create);
  const remove = useMutation(api.problems.remove);
  const reserve = useMutation(api.uploads.reserve);
  const finalize = useAction(api.uploads.finalize);
  const analyze = useMutation(api.problems.analyze);
  const transcribe = useMutation(api.problems.transcribe);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const submit = async (data: IntakeSubmission) => {
    if (busy) return;
    setBusy(true);
    let problemId: Id<"problems"> | undefined;
    try {
      setStatus("Creating your private repair…");
      problemId = await create({ text: data.text, consent: data.consent });
      const files = [...data.photos.map(file => ({ file, kind: "photo" as const, duration: undefined as number | undefined })), ...(data.audio ? [{ ...data.audio, kind: "audio" as const }] : [])];
      for (let i = 0; i < files.length; i++) {
        const {file, kind, duration} = files[i];
        setStatus(`Uploading ${kind} ${i + 1} of ${files.length}…`);
        const reservation = await reserve({ problemId, kind });
        const response = await fetch(reservation.uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!response.ok) throw new Error("The upload was interrupted. Please try again.");
        const result: { storageId?: Id<"_storage"> } = await response.json();
        if (!result.storageId) throw new Error("The upload did not return a file reference.");
        await finalize({ reservationId: reservation.reservationId, storageId: result.storageId, durationSeconds: duration });
      }
      setStatus(data.audio ? "Starting transcription. You’ll confirm it before analysis." : "Requesting your next step…");
      if (data.audio) await transcribe({ problemId }); else await analyze({ problemId });
      router.push(`/problems/${problemId}`);
    } catch (error) {
      setStatus("Your local inputs are still here. Review the error and try again.");
      if (problemId) {
        try { await remove({ problemId }); }
        catch { setStatus("An incomplete draft remains in My repairs. Open it to retry or delete it."); }
      }
      throw error;
    } finally { setBusy(false); }
  };
  return <IntakeForm onSubmit={submit} busy={busy} status={status}/>;
}
