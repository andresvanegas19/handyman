import { describe, expect, it } from "vitest";
import { needsImmediateSafety, repairRecommendations } from "./repairRecommendations";
import type { Recognition } from "./repairContracts";

const recognition: Recognition = {
  outcome: "referral", summary: "A dishwasher appears visible.", product: "dishwasher",
  brand: "Example", model: "D1", variant: "", symptom: "error code",
  features: ["control panel"], prerequisites: [], confidence: 0.94,
};

describe("safe recommendations independent of 3D", () => {
  it("supports thermostat planning without guessing wiring or requiring a model", () => {
    const result = repairRecommendations("Installing a smart thermostat", {
      ...recognition, product: "thermostat", symptom: "installation planning",
    });
    expect(result.summary).toContain("do not depend on 3D readiness");
    expect(result.items.map(item => item.title)).toContain("Check thermostat and HVAC compatibility");
    expect(result.items.map(item => item.description).join(" ")).toContain("Wire colors");
    expect(result.items.map(item => item.description).join(" ")).toContain("qualified HVAC installer");
    expect(result.questions.join(" ")).toContain("HVAC models");
  });
  it("exposes image-to-text and visible features even with an empty product and a referral", () => {
    const result = repairRecommendations("No confirmed fault", {
      ...recognition, product: "", features: ["sink basin", "P-trap", "wrench"],
      imageDescription: "A sink drain with a curved pipe and a wrench is visible.",
    }, undefined, "google/gemma-3-12b-it");
    expect(result.identification).toBeUndefined();
    expect(result.imageDescription).toBe("A sink drain with a curved pipe and a wrench is visible.");
    expect(result.visibleFeatures).toEqual(["sink basin", "P-trap", "wrench"]);
  });

  it("keeps existing image features usable without inventing a caption for older records", () => {
    const result = repairRecommendations("No confirmed fault", recognition, undefined, "google/gemma-3-12b-it");
    expect(result.imageDescription).toBeUndefined();
    expect(result.visibleFeatures).toEqual(["control panel"]);
  });

  it("does not label local screening or the user's prompt as an image description", () => {
    const result = repairRecommendations("A claimed leak", {
      ...recognition, imageDescription: "Local screening text",
    }, undefined, "local-safety-screen");
    expect(result.imageDescription).toBeUndefined();
    expect(result.visibleFeatures).toBeUndefined();
  });

  it("keeps actual image identification, model attribution and appliance recommendations", () => {
    const result = repairRecommendations("My dishwasher displays E1", recognition, undefined, "qwen/qwen3.8-flash");
    expect(result.identification).toEqual({ product: "dishwasher", brand: "Example", model: "D1", confidence: 0.94 });
    expect(result.visionModel).toBe("qwen/qwen3.8-flash");
    expect(result.urgent).toBe(false);
    expect(result.items.some(item => item.title.includes("error"))).toBe(true);
    expect(result.questions).toHaveLength(2);
  });

  it.each(["The faucet is dripping", "The drawer handle is loose", "An unknown object is broken"])(
    "provides useful next steps without inventing image recognition: %s", description => {
      const result = repairRecommendations(description);
      expect(result.items.length).toBeGreaterThanOrEqual(3);
      expect(result.questions.length).toBeGreaterThan(0);
      expect(result.identification).toBeUndefined();
      expect(result.visionModel).toBeUndefined();
      expect(result.summary).toContain("not been reliably identified");
    },
  );

  it("retains urgent safety advice even before vision and never asks for closer photos", () => {
    const result = repairRecommendations("Gas leak near the stove");
    expect(result.urgent).toBe(true);
    expect(result.items[0].description).toContain("move away to safety");
    expect(result.questions).toEqual([]);
    expect(needsImmediateSafety("There are sp\u200barks in a socket")).toBe(true);
  });

  it("does not pretend old keyword-only screening was image recognition", () => {
    const result = repairRecommendations("Dishwasher error", { ...recognition, product: "", confidence: 0 }, undefined, "deterministic-safety-screen");
    expect(result.visionModel).toBeUndefined();
    expect(result.identification).toBeUndefined();
  });

  it("returns safe provenance links but never turns retrieved text into instructions", () => {
    const result = repairRecommendations("Dishwasher error", recognition, {
      sources: [
        { id: "safe", url: "https://support.example.com/manual", title: "Manual", excerpt: "UNSAFE raw disassembly instruction" },
        { id: "local", url: "http://localhost/private", title: "Bad", excerpt: "secret" },
      ],
      images: [],
    });
    expect(result.sources).toEqual([{ url: "https://support.example.com/manual", title: "Manual" }]);
    expect(JSON.stringify(result)).not.toContain("UNSAFE");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
