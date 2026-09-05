import { z } from "zod";

export const TEMPORARY_STORAGE_KEY = "handyman:temporary:v1";
const attachment = z.object({
  id: z.string().min(1), name: z.string().max(500),
  kind: z.enum(["photo", "audio"]), type: z.string().max(100),
  bytes: z.number().nonnegative(),
  duration: z.number().positive().max(60).optional(),
}).strict();

const repair = z.object({
  id: z.string().min(1), text: z.string().max(4000),
  notes: z.string().max(8000), createdAt: z.number(), updatedAt: z.number(),
  attachments: z.array(attachment).max(4),
  selectedGuideSlug: z.string().max(100).optional(),
}).strict();

const rating = z.object({
  slug: z.string().max(100), version: z.number().int().positive(),
  outcome: z.enum(["worked", "partly", "not_worked"]),
  comment: z.string().max(1000), updatedAt: z.number(),
}).strict();

export const temporaryStateSchema = z.object({
  version: z.literal(1),
  repairs: z.array(repair).max(20),
  ratings: z.array(rating).max(100),
}).strict();

export type TemporaryRepair = z.infer<typeof repair>;
export type TemporaryAttachment = z.infer<typeof attachment>;
export type TemporaryRating = z.infer<typeof rating>;
export type TemporaryState = z.infer<typeof temporaryStateSchema>;
export const emptyTemporaryState = (): TemporaryState => ({ version: 1, repairs: [], ratings: [] });

export function readTemporaryState(storage: Pick<Storage, "getItem">): TemporaryState {
  const saved = storage.getItem(TEMPORARY_STORAGE_KEY);
  if (saved === null) return emptyTemporaryState();
  return temporaryStateSchema.parse(JSON.parse(saved));
}

export function writeTemporaryState(storage: Pick<Storage, "setItem">, state: TemporaryState) {
  storage.setItem(TEMPORARY_STORAGE_KEY, JSON.stringify(temporaryStateSchema.parse(state)));
}
