// @vitest-environment node
import { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repairLogArgs, startDev } from "../../scripts/dev.mjs";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawn,
}));

let children: ChildProcess[];
let stop: ReturnType<typeof startDev> | undefined;
beforeEach(() => {
  children = [];
  spawn.mockReset().mockImplementation(() => {
    const child = new ChildProcess();
    vi.spyOn(child, "kill").mockReturnValue(true);
    children.push(child);
    return child;
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  stop?.();
  stop = undefined;
  process.exitCode = 0;
  vi.restoreAllMocks();
});

describe("development terminal logs", () => {
  it("selects the frontend cloud deployment rather than an unrelated CLI default", () => {
    expect(repairLogArgs({
      NEXT_PUBLIC_CONVEX_URL: "https://target-123.convex.cloud",
      CONVEX_DEPLOYMENT: "dev:other-456",
    })).toEqual(["logs", "--history", "10", "--deployment", "target-123"]);
    expect(repairLogArgs({ NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210" }))
      .toEqual(["logs", "--history", "10", "--deployment", "local"]);
    expect(repairLogArgs({ NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210", CONVEX_DEPLOYMENT: "anonymous:anonymous-agent" }))
      .toEqual(["logs", "--history", "10"]);
    expect(repairLogArgs({})).toBeNull();
    expect(() => repairLogArgs({ NEXT_PUBLIC_CONVEX_URL: "https://custom.example" })).toThrow("matching deployment");
  });

  it("runs Next.js and read-only logs together, passes through arguments, and stops both", () => {
    stop = startDev(["--port", "3105"], { NEXT_PUBLIC_CONVEX_URL: "https://target-123.convex.cloud" });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0][1]).toEqual([expect.stringContaining("next"), "dev", "--port", "3105"]);
    expect(spawn.mock.calls[1][1]).toEqual([expect.stringContaining("convex"), "logs", "--history", "10", "--deployment", "target-123"]);
    expect(spawn.mock.calls[1][2].stdio).toEqual(["ignore", "inherit", "inherit"]);
    stop();
    for (const child of children) expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("preserves temporary mode without connecting to Convex", () => {
    stop = startDev([], {});
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Temporary mode"));
  });

  it("does not connect logs when showing Next.js help", () => {
    stop = startDev(["--help"], { NEXT_PUBLIC_CONVEX_URL: "https://target-123.convex.cloud" });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("reports log stream failures without killing the website", () => {
    stop = startDev([], { NEXT_PUBLIC_CONVEX_URL: "https://target-123.convex.cloud" });
    children[1].emit("exit", 1, null);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Backend logs are no longer visible"));
    expect(children[0].kill).not.toHaveBeenCalled();
  });

  it("stops the log stream if the web server exits", () => {
    stop = startDev([], { NEXT_PUBLIC_CONVEX_URL: "https://target-123.convex.cloud" });
    children[0].emit("exit", 1, null);
    expect(children[1].kill).toHaveBeenCalledWith("SIGTERM");
    expect(process.exitCode).toBe(1);
  });
});
