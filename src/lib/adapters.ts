import type { ReviewedAssembly } from "./domain";

export function toReviewedAssembly(value: { url: string; reviewed: boolean; parts: { id: string; label: string; description: string; nodeNames: string[]; explodeOffset: number[] }[] } | null | undefined): ReviewedAssembly | undefined {
  if (!value?.reviewed || value.parts.some(part => part.explodeOffset.length !== 3 || part.explodeOffset.some(n => !Number.isFinite(n)))) return undefined;
  return { url: value.url, reviewed: true, parts: value.parts.map(part => ({ ...part, explodeOffset: [part.explodeOffset[0], part.explodeOffset[1], part.explodeOffset[2]] })) };
}
