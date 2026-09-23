import { afterEach, describe, expect, it, vi } from "vitest";
import { repairErrorCode, repairLog } from "./repair-log";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("repair diagnostics", () => {
  it("writes backend events as single-line terminal logs by default", () => {
    vi.stubGlobal("window", undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repairLog("stage.error", { runId: "run-1", phase: "researching", code: "provider_http_429" }, "error");
    expect(error).toHaveBeenCalledWith("[repair]", expect.any(String));
    const line = error.mock.calls[0][1];
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      event: "stage.error", runtime: "server", runId: "run-1", phase: "researching", code: "provider_http_429",
    });
  });

  it("logs only allowlisted operational fields with correlation IDs", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const details = {
      problemId: "problem-1", runId: "run-1", phase: "recognizing", count: 1,
      prompt: "private description", token: "private-token", photo: "data:image/png;base64,private",
      url: "https://private.example/model?token=secret", response: { secret: true },
    };
    repairLog("stage.started", details);
    expect(info).toHaveBeenCalledExactlyOnceWith("[repair]", {
      event: "stage.started", timestamp: expect.any(String), runtime: "browser",
      problemId: "problem-1", runId: "run-1", phase: "recognizing", count: 1,
    });
  });

  it("uses the requested severity and omits undefined and nonfinite values", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repairLog("stage.failed", { stageId: "stage-1", bytes: NaN, count: Infinity, httpStatus: 401, retryable: false }, "error");
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({
      event: "stage.failed", stageId: "stage-1", httpStatus: 401, retryable: false,
    }));
    expect(error.mock.calls[0][1]).not.toHaveProperty("bytes");
    expect(error.mock.calls[0][1]).not.toHaveProperty("count");
  });

  it.each([
    ["OPENROUTER_API_KEY is not configured.", "missing_openrouter_key"],
    ["FIRECRAWL_API_KEY is not configured.", "missing_firecrawl_key"],
    ["Provider request rejected (HTTP 429).", "provider_http_429"],
    ["OpenRouter model allowlist is invalid.", "invalid_configuration"],
    ["No supporting evidence was found.", "research_evidence_missing"],
    ["Untrusted Tripo asset URL.", "untrusted_asset_host"],
    ["Invalid GLB header.", "invalid_model_geometry"],
    ["The segmented model does not contain distinct named parts.", "mapping_unavailable"],
    ["Asset exceeds the size limit.", "asset_download_invalid"],
    ["No eligible OpenRouter model meets capability, pricing, and budget requirements.", "model_or_budget_unavailable"],
    ["Request failed https://private.example?token=secret Bearer private-token", "processing_failed"],
  ])("classifies errors without exposing their raw messages", (message, code) => {
    expect(repairErrorCode(new Error(message))).toBe(code);
  });

  it("logs bounded operation timing without exposing validation or network error payloads", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repairLog("tripo.poll.failed", { operation: "model_validation", elapsedMs: 1200, requestId: "task-1" }, "error");
    expect(error).toHaveBeenCalledWith("[repair]", expect.objectContaining({
      operation: "model_validation", elapsedMs: 1200, requestId: "task-1",
    }));
    expect(repairErrorCode(new SyntaxError("private response body"))).toBe("invalid_provider_output");
    expect(repairErrorCode(new DOMException("private URL", "TimeoutError"))).toBe("request_failed_or_timed_out");
    expect(repairErrorCode({ message: "private data" })).toBe("processing_failed");
  });
});
