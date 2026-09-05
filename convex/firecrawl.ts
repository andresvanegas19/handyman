import { z } from "zod";
import type { Recognition, Research } from "./repairContracts";

const shortText = z.string().trim().max(300);
export const recognitionSchema = z.object({
  outcome: z.enum(["identified", "needs_input", "referral"]),
  summary: z.string().trim().min(1).max(1200),
  product: shortText, brand: shortText, model: shortText, variant: shortText,
  symptom: shortText,
  features: z.array(shortText).max(12),
  prerequisites: z.array(shortText).max(12),
  confidence: z.number().finite().min(0).max(1),
}).strict();

// Links are provenance only, not download authorization. Reject all IP literals
// and local/reserved hostnames rather than trying to resolve untrusted addresses.
export function publicHttpsUrl(value: string): string | null {
  if (value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password ||
    (url.port && url.port !== "443") || !host.includes(".") ||
    /[:[\]]/.test(host) || /^[\d.]+$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host) ||
    !/^[a-z0-9.-]+$/.test(host)) return null;
  url.hash = "";
  return url.href;
}

const link = z.string().refine(value => publicHttpsUrl(value) !== null);
export const researchSchema = z.object({
  sources: z.array(z.object({
    id: z.string().regex(/^source-\d+$/), url: link,
    title: z.string().min(1).max(300), excerpt: z.string().min(1).max(6000),
  }).strict()).max(5),
  images: z.array(z.object({
    url: link, pageUrl: link, title: z.string().max(300),
  }).strict()).max(5),
}).strict();

export async function providerJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok) throw new Error(`Provider request rejected (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Provider returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Provider response exceeded the size limit.");
      }
      chunks.push(value);
    }
  } catch {
    throw new Error("Provider response could not be read within limits.");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Provider returned malformed JSON."); }
}

export async function providerFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000) });
  } catch {
    // Never propagate network exceptions: they can contain request URLs or credentials.
    throw new Error("Provider request failed or timed out. No automatic retry was made.");
  }
}

const searchEnvelope = z.object({
  success: z.literal(true),
  data: z.object({
    web: z.array(z.object({
      url: z.string(), title: z.string().optional(), markdown: z.string().nullable().optional(),
      metadata: z.object({
        sourceURL: z.string().optional(), url: z.string().optional(),
        statusCode: z.number().optional(), error: z.string().nullable().optional(),
      }).optional(),
    })).max(100).optional(),
    images: z.array(z.object({
      imageUrl: z.string(), url: z.string(), title: z.string().optional(),
    })).max(100).optional(),
  }),
});

function queryTerm(value: string): string {
  return value
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+|\b(?:\d[\s()-]*){7,}\b/gi, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 65);
}

export async function researchProduct(input: Recognition): Promise<Research> {
  const parsed = recognitionSchema.safeParse(input);
  if (!parsed.success || parsed.data.outcome !== "identified" || !parsed.data.product) {
    throw new Error("Research requires an identified product.");
  }
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not configured.");
  const recognition = parsed.data;
  // Do not send the raw description, photo, features, or personal context to search.
  const query = [recognition.brand, recognition.product, recognition.model, recognition.variant]
    .map(queryTerm).filter(Boolean).map(term => `"${term}"`).join(" ");
  const response = await providerFetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `${query} manufacturer official support manual ${queryTerm(recognition.symptom)}`.slice(0, 500),
      sources: [{ type: "web" }, { type: "images" }], limit: 5, timeout: 45_000,
      scrapeOptions: {
        formats: ["markdown"], onlyMainContent: true, skipTlsVerification: false,
        timeout: 15_000, parsers: [{ type: "pdf", maxPages: 3 }],
      },
    }),
  });
  const envelope = searchEnvelope.safeParse(await providerJson(response, 2_000_000));
  if (!envelope.success) throw new Error("Firecrawl returned an invalid search response.");
  const sources: Research["sources"] = [];
  const seen = new Set<string>();
  for (const item of envelope.data.data.web ?? []) {
    const url = publicHttpsUrl(item.url);
    const sourceUrl = item.metadata?.sourceURL ? publicHttpsUrl(item.metadata.sourceURL) : url;
    const finalUrl = item.metadata?.url ? publicHttpsUrl(item.metadata.url) : url;
    if (!url || !sourceUrl || !finalUrl || sourceUrl !== url || finalUrl !== url || item.metadata?.error ||
      (item.metadata?.statusCode !== undefined && item.metadata.statusCode !== 200) ||
      !item.markdown?.trim() || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      id: `source-${sources.length + 1}`, url,
      title: (item.title?.trim() || new URL(url).hostname).slice(0, 300),
      excerpt: item.markdown.trim().slice(0, 6000),
    });
    if (sources.length === 5) break;
  }
  const images: Research["images"] = [];
  const seenImages = new Set<string>();
  for (const item of envelope.data.data.images ?? []) {
    const url = publicHttpsUrl(item.imageUrl);
    const pageUrl = publicHttpsUrl(item.url);
    if (!url || !pageUrl || seenImages.has(url)) continue;
    seenImages.add(url);
    images.push({ url, pageUrl, title: (item.title ?? "").slice(0, 300) });
    if (images.length === 5) break;
  }
  return researchSchema.parse({ sources, images });
}
