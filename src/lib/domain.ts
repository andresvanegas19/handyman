export type Outcome = "worked" | "partly" | "not_worked";
export type Category = "Doors & windows" | "Furniture" | "Plumbing";
export type AssemblyKind = "door" | "hinge" | "knob" | "aerator";

export interface GuideStep {
  title: string;
  description: string;
  partIds: string[];
  visual?: {
    location: string;
    lookFor: string;
    motion: string;
    force: string;
    risk: string;
    check: string;
  };
}

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  category: Category;
  difficulty: "Easy";
  duration: string;
  symptoms: string[];
  tools: string[];
  prerequisites: string[];
  stopConditions: string[];
  steps: GuideStep[];
  assemblyKind?: AssemblyKind;
  /** Starter content is not approved repair guidance. */
  status: "draft" | "published";
  version: number;
}

export interface AssemblyPart {
  id: string;
  label: string;
  description: string;
  nodeNames: string[];
  explodeOffset: [number, number, number];
}

export interface ReviewedAssembly {
  url: string;
  parts: AssemblyPart[];
  reviewed: boolean;
}

export const INPUT_LIMITS = {
  text: 4000,
  photos: 3,
  photoBytes: 10 * 1024 * 1024,
  audioBytes: 15 * 1024 * 1024,
  audioSeconds: 60,
} as const;

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"] as const;
