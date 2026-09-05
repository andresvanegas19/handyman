"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  emptyTemporaryState, readTemporaryState, TEMPORARY_STORAGE_KEY,
  writeTemporaryState, type TemporaryRating, type TemporaryRepair, type TemporaryState,
} from "@/lib/temporary-storage";
import { validateAudio, validatePhoto } from "@/lib/media";
import { STARTER_GUIDES } from "@/lib/catalog";
import type { IntakeSubmission } from "./intake/intake-form";

interface TemporaryStore {
  data: TemporaryState;
  ready: boolean;
  error: string;
  createRepair: (input: IntakeSubmission) => string;
  updateRepair: (id: string, fields: Pick<TemporaryRepair, "text" | "notes" | "selectedGuideSlug">) => void;
  removeRepair: (id: string) => void;
  saveRating: (rating: Omit<TemporaryRating, "updatedAt">) => void;
  getFile: (id: string) => File | undefined;
  clear: () => void;
}

const TemporaryStoreContext = createContext<TemporaryStore | null>(null);

export function TemporaryStoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<TemporaryState>(emptyTemporaryState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(data);
  const files = useRef(new Map<string, File>());

  useEffect(() => {
    try {
      const saved = readTemporaryState(window.sessionStorage);
      current.current = saved;
      setData(saved);
    } catch {
      setError("This tab's temporary data could not be loaded. Enable browser storage, or clear this tab's saved data to start again.");
    } finally {
      setReady(true);
    }
  }, []);

  function commit(next: TemporaryState) {
    if (!ready || error) throw new Error(error || "Temporary storage is still loading.");
    try { writeTemporaryState(window.sessionStorage, next); }
    catch { throw new Error("Could not save in this tab. Browser storage may be full or disabled. Your current input has not been cleared."); }
    current.current = next;
    setData(next);
  }

  function createRepair(input: IntakeSubmission) {
    if (!input.consent) throw new Error("Please accept the temporary-storage notice first.");
    if (!input.text.trim() && !input.photos.length && !input.audio) throw new Error("Add text, a photo, or audio first.");
    if (current.current.repairs.length >= 20) throw new Error("This tab can hold 20 repairs. Delete an older repair first.");
    if (input.photos.length > 3) throw new Error("Choose no more than three photos.");
    for (const photo of input.photos) {
      const invalid = validatePhoto(photo);
      if (invalid) throw new Error(invalid);
    }
    if (input.audio) {
      const invalid = validateAudio(input.audio.file);
      if (invalid) throw new Error(invalid);
    }
    const incoming = [
      ...input.photos.map(file => ({ file, kind: "photo" as const, duration: undefined as number | undefined })),
      ...(input.audio ? [{ ...input.audio, kind: "audio" as const }] : []),
    ].map(item => ({ ...item, id: crypto.randomUUID() }));
    const id = crypto.randomUUID();
    const now = Date.now();
    const repair: TemporaryRepair = {
      id, text: input.text.trim(), notes: "", createdAt: now, updatedAt: now,
      attachments: incoming.map(({ id, file, kind, duration }) => ({
        id, name: file.name, kind, type: file.type, bytes: file.size, duration,
      })),
    };
    commit({ ...current.current, repairs: [repair, ...current.current.repairs] });
    for (const attachment of incoming) files.current.set(attachment.id, attachment.file);
    return id;
  }

  function updateRepair(id: string, fields: Pick<TemporaryRepair, "text" | "notes" | "selectedGuideSlug">) {
    if (!current.current.repairs.some(repair => repair.id === id)) throw new Error("This temporary repair is no longer available.");
    if (fields.selectedGuideSlug && !STARTER_GUIDES.some(guide => guide.slug === fields.selectedGuideSlug)) throw new Error("Choose an available catalog example.");
    commit({
      ...current.current,
      repairs: current.current.repairs.map(repair => repair.id === id ? { ...repair, ...fields, updatedAt: Date.now() } : repair),
    });
  }

  function removeRepair(id: string) {
    const repair = current.current.repairs.find(item => item.id === id);
    if (!repair) throw new Error("This temporary repair is no longer available.");
    commit({ ...current.current, repairs: current.current.repairs.filter(item => item.id !== id) });
    for (const attachment of repair.attachments) files.current.delete(attachment.id);
  }

  function saveRating(rating: Omit<TemporaryRating, "updatedAt">) {
    if (!STARTER_GUIDES.some(guide => guide.slug === rating.slug && guide.version === rating.version)) throw new Error("This guide revision is not available.");
    const remaining = current.current.ratings.filter(item => item.slug !== rating.slug || item.version !== rating.version);
    commit({ ...current.current, ratings: [...remaining, { ...rating, updatedAt: Date.now() }] });
  }

  function clear() {
    try { window.sessionStorage.removeItem(TEMPORARY_STORAGE_KEY); }
    catch { throw new Error("Browser storage could not be cleared. Check this browser's storage settings."); }
    files.current.clear();
    current.current = emptyTemporaryState();
    setData(current.current);
    setError("");
  }

  return <TemporaryStoreContext.Provider value={{
    data, ready, error, createRepair, updateRepair, removeRepair, saveRating,
    getFile: id => files.current.get(id), clear,
  }}>{children}</TemporaryStoreContext.Provider>;
}

export function useTemporaryStore() {
  const store = useContext(TemporaryStoreContext);
  if (!store) throw new Error("Temporary storage provider is missing.");
  return store;
}

export function TemporaryStorageNotice() {
  return <div className="notice notice-sage"><div>
    <strong>Temporary MVP — saved only in this tab</strong>
    <p>Text and feedback survive refresh and normally clear when this tab closes. Photos and audio stay in memory and clear on refresh. Nothing is uploaded; no AI analysis runs in this mode.</p>
  </div></div>;
}

export function TemporaryStorageGate({ children }: { children: React.ReactNode }) {
  const store = useTemporaryStore();
  const [failure, setFailure] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!store.ready) return <p role="status">Opening temporary storage...</p>;
  if (!store.error) return children;
  return <div className="notice notice-error"><div>
    <p role="alert">{failure || store.error}</p>
    <button className="button button-secondary" onClick={() => setConfirm(true)}>Clear this tab&apos;s data</button>
    {confirm && <><p>This removes this tab&apos;s saved repair text and ratings.</p><button className="button button-danger" onClick={() => {
      try { store.clear(); } catch (error) { setFailure(error instanceof Error ? error.message : "Storage could not be cleared."); }
    }}>Confirm clear</button></>}
  </div></div>;
}
