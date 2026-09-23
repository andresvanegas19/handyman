interface RepairLogDetails {
  problemId?: string;
  runId?: string;
  stageId?: string;
  sceneId?: string;
  requestId?: string;
  phase?: string;
  nextPhase?: string;
  workflow?: string;
  provider?: string;
  status?: string;
  code?: string;
  attempt?: number;
  step?: number;
  count?: number;
  bytes?: number;
  httpStatus?: number;
  cacheHit?: boolean;
  retryable?: boolean;
  ambiguous?: boolean;
  enabled?: boolean;
  configured?: boolean;
  operation?: string;
  model?: string;
  elapsedMs?: number;
}

const fields = [
  "problemId", "runId", "stageId", "sceneId", "requestId", "phase", "nextPhase",
  "workflow", "provider", "status", "code", "attempt", "step", "count", "bytes",
  "httpStatus", "cacheHit", "retryable", "ambiguous", "enabled", "configured",
  "operation", "elapsedMs", "model",
] as const;

/** Only operational metadata is logged, never payloads, raw errors, or credentials. */
export function repairLog(
  event: string, details: RepairLogDetails = {}, level: "info" | "warn" | "error" = "info",
  format: "structured" | "compact" = typeof window === "undefined" ? "compact" : "structured",
) {
  const safe: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const value = details[field];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) safe[field] = value;
    else if (typeof value === "string") safe[field] = value.slice(0, 120);
  }
  const entry = {
    event, timestamp: new Date().toISOString(),
    runtime: typeof window === "undefined" ? "server" : "browser",
    ...safe,
  };
  console[level]("[repair]", format === "compact" ? JSON.stringify(entry) : entry);
}

export function repairErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error &&
      (error.name === "AbortError" || error.name === "TimeoutError")) return "request_failed_or_timed_out";
  if (!(error instanceof Error)) return "processing_failed";
  const message = error.message;
  if (message === "OPENROUTER_API_KEY is not configured.") return "missing_openrouter_key";
  if (message === "FIRECRAWL_API_KEY is not configured.") return "missing_firecrawl_key";
  if (message === "Tripo is not configured.") return "missing_tripo_configuration";
  if (message === "OpenRouter model allowlist is invalid." || message === "OpenRouter provider allowlist is invalid.") return "invalid_configuration";
  if (message === "No supporting evidence was found.") return "research_evidence_missing";
  if (message === "Firecrawl returned an invalid search response.") return "invalid_research_output";
  if (message === "Untrusted Tripo asset URL.") return "untrusted_asset_host";
  if (message === "The provider could not produce a model.") return "provider_model_unavailable";
  if (message === "Task polling limit exceeded.") return "poll_limit_exceeded";
  if (message === "Task identity mismatch.") return "provider_task_mismatch";
  if (message === "Invalid source photo." || message === "Source photo unavailable.") return "source_photo_unavailable";
  if (message === "Asset download failed or exceeds the size limit." || message === "Asset exceeds the size limit.") return "asset_download_invalid";
  if (message === "Stored model unavailable." || message === "Reference or stored model is unavailable.") return "stored_model_unavailable";
  if (error.name === "ZodError" || error instanceof SyntaxError) return "invalid_provider_output";
  const http = /^Provider request rejected \(HTTP (\d{3})\)\.$/.exec(message);
  if (http) return `provider_http_${http[1]}`;
  if (/^(Invalid |Configure ).*configuration|^Configure .*DAILY_LIMIT/.test(message)) return "invalid_configuration";
  if (/^Requested OpenRouter|^No eligible OpenRouter/.test(message)) return "model_or_budget_unavailable";
  if (/^OpenRouter.*(schema|structured|completion)|^Provider returned malformed JSON/.test(message)) return "invalid_provider_output";
  if (/^Mapping|^Model nodes|^The segmented model/.test(message)) return "mapping_unavailable";
  if (/^(Invalid GLB|GLB |All GLB|Unsupported GLB|Invalid buffer|Accessor exceeds|Invalid mesh|Invalid triangle|Invalid node|Export dense|Export triangulated)/.test(message)) return "invalid_model_geometry";
  if (/^Repair instructions require|^Repair plan exceeds|^This problem exceeds|^Mechanical repair applicability|^Repeated tightening|^No supported source-grounded repair/.test(message)) return "unsupported_repair";
  if (error.name === "AbortError" || error.name === "TimeoutError" || message === "Provider request failed or timed out. No automatic retry was made.") return "request_failed_or_timed_out";
  return "processing_failed";
}
