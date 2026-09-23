"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { isConnected, visualRepairEnabled } from "@/lib/config";
import { repairErrorCode, repairLog } from "@/lib/repair-log";
import IntakeForm, { type IntakeSubmission } from "./intake-form";
import AuthGate from "../auth-gate";
import { TemporaryIntake } from "../temporary-repairs";

export default function Intake() {
  useEffect(() => {
    repairLog("intake.configuration", { configured: isConnected, enabled: visualRepairEnabled });
  }, []);
  return isConnected ? <AuthGate><ConnectedIntake/></AuthGate> : <TemporaryIntake/>;
}
function ConnectedIntake() {
  const [legacy, setLegacy] = useState(false);
  useEffect(() => { setLegacy(new URLSearchParams(window.location.search).get("input") === "audio"); }, []);
  useEffect(() => {
    repairLog("intake.mode", { workflow: legacy ? "legacy" : "visual", enabled: visualRepairEnabled, status: !legacy && !visualRepairEnabled ? "setup_required" : "available" });
  }, [legacy]);
  return <>{legacy ? <><p>Legacy audio and text repair · review your transcript before analysis. This separate workflow does not automatically prepare a 3D guide.</p><AuthenticatedIntake/><Link href="/problems/new" onClick={() => setLegacy(false)}>Use photo + written visual repair instead</Link></> : <>{visualRepairEnabled ? <VisualIntake/> : <VisualRepairSetup/>}<Link href="/problems/new?input=audio" onClick={() => setLegacy(true)}>Use the separate legacy audio workflow</Link></>}</>;
}

function VisualRepairSetup() {
  return <>
    <div className="notice" role="alert"><div>
      <strong>Automatic 3D repair is not enabled yet.</strong>
      <p>This workflow needs a photo and a written description. Once enabled, submitting starts saved progress and opens the mapped 3D guide when it is ready. Nothing will be submitted to the old analysis workflow instead.</p>
      <details><summary>Administrator setup</summary>
        <p>Configure Firecrawl, OpenRouter, and Tripo credentials and spending limits in Convex, set <code>VISUAL_REPAIR_ENABLED=true</code>, and deploy the backend. Set <code>NEXT_PUBLIC_VISUAL_REPAIR_ENABLED=true</code> for this website, then restart the local server or rebuild and redeploy it. Publishing the website alone does not activate the backend.</p>
      </details>
    </div></div>
    <IntakeForm workflow="visual"/>
  </>;
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
  const handedOff = useRef(false);
  const incomplete = useRef<Id<"problems"> | null>(null);
  const creation = useRef<{ id: string; text: string; consent: boolean; photos: File[] } | null>(null);
  const submit = async (data: IntakeSubmission) => {
    if (active.current || handedOff.current) return;
    if (!data.text.trim() || !data.photos.length || !data.consent || data.audio) throw new Error("A photo, written description, and provider consent are required.");
    active.current = true;
    setBusy(true);
    let problemId: Id<"problems"> | undefined;
    let uploaded = false;
    try {
      if (incomplete.current) {
        await remove({ problemId: incomplete.current });
        incomplete.current = null;
        creation.current = null;
      }
      const text = data.text.trim();
      if (!creation.current || creation.current.text !== text || creation.current.consent !== data.consent ||
        creation.current.photos.length !== data.photos.length || data.photos.some((photo, index) => photo !== creation.current?.photos[index])) {
        creation.current = { id: crypto.randomUUID(), text, consent: data.consent, photos: [...data.photos] };
      }
      setStatus("Saving your private photo and written description…");
      repairLog("intake.create.started", { requestId: creation.current.id, count: data.photos.length });
      problemId = await create({ text, consent: data.consent, workflow: "visual", clientRequestId: creation.current.id });
      repairLog("intake.create.completed", { requestId: creation.current.id, problemId });
      incomplete.current = problemId;
      for (const [index, file] of data.photos.entries()) {
        setStatus(`Uploading photo ${index + 1} of ${data.photos.length}…`);
        repairLog("intake.photo.reserve", { problemId, step: index + 1 });
        const reservation = await reserve({ problemId, kind: "photo" });
        repairLog("intake.photo.upload", { problemId, step: index + 1, bytes: file.size });
        const response = await fetch(reservation.uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file, signal: AbortSignal.timeout(60_000) });
        repairLog("intake.photo.response", { problemId, step: index + 1, httpStatus: response.status });
        if (!response.ok) throw new Error("The upload was interrupted. Your local inputs are still here.");
        const result: { storageId?: Id<"_storage"> } = await response.json();
        if (!result.storageId) throw new Error("The upload did not return a file reference.");
        repairLog("intake.photo.finalize", { problemId, step: index + 1 });
        await finalize({ reservationId: reservation.reservationId, storageId: result.storageId });
        repairLog("intake.photo.completed", { problemId, step: index + 1 });
      }
      uploaded = true;
      incomplete.current = null;
      setStatus("Starting automatic recognition, research, and mapped 3D preparation…");
      repairLog("intake.pipeline.start", { problemId });
      await start({ problemId });
      repairLog("intake.pipeline.accepted", { problemId });
      handedOff.current = true;
      router.push(`/problems/${problemId}`);
    } catch (error) {
      repairLog("intake.failed", { problemId, code: repairErrorCode(error) }, "error");
      if (uploaded && problemId) {
        // A lost start response must not delete an accepted run or cause a second paid submission.
        handedOff.current = true;
        repairLog("intake.pipeline.reconciling", { problemId }, "warn");
        router.push(`/problems/${problemId}`);
        return;
      }
      setStatus("Your local inputs are still here. Review the error and try again.");
      if (problemId) {
        try { await remove({ problemId }); incomplete.current = null; creation.current = null; }
        catch { setStatus("An incomplete private draft remains in My repairs. Retrying will clean it up before creating another."); }
      }
      throw error;
    } finally { active.current = false; if (!handedOff.current) setBusy(false); }
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
