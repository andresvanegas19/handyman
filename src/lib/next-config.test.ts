import { describe, expect, it } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import config from "../../next.config";

describe("Next.js build output isolation", () => {
  it("keeps development chunks separate from production builds", () => {
    expect(config(PHASE_DEVELOPMENT_SERVER).distDir).toBe(".next-dev");
    expect(config(PHASE_DEVELOPMENT_SERVER).distDir).not.toBe(config(PHASE_PRODUCTION_BUILD).distDir);
  });

  it("serves the same production output that the build generates", () => {
    expect(config(PHASE_PRODUCTION_BUILD).distDir).toBe(".next");
    expect(config(PHASE_PRODUCTION_SERVER).distDir).toBe(config(PHASE_PRODUCTION_BUILD).distDir);
  });
});
