import { describe, expect, it } from "vitest";
import { STARTER_GUIDES, GUIDE_PHOTOS } from "./catalog";
import { editableGuide } from "./editor-validation";
import { PREVIEW_PARTS } from "@/components/viewer/parts";

describe("washer catalog example", () => {
  it("remains a valid draft with every checkpoint mapped to washer parts", () => {
    const guide = STARTER_GUIDES.find(item => item.slug === "washing-machine-control-knob");
    expect(guide).toBeDefined();
    if (!guide?.assemblyKind) throw new Error("Washer example requires an assembly.");
    expect(editableGuide.safeParse(guide).success).toBe(true);
    expect(guide.category).toBe("Appliances");
    expect(guide.status).toBe("draft");
    const ids = PREVIEW_PARTS[guide.assemblyKind].map(part => part.id);
    for (const step of guide.steps) {
      expect(step.visual).toBeDefined();
      expect(step.partIds.length).toBeGreaterThan(0);
      for (const id of step.partIds) expect(ids).toContain(id);
    }
    expect(GUIDE_PHOTOS[guide.slug]?.src).toBe("/examples/washing-machine-control-knob.png");
    expect(guide.steps.map(step => step.description).join(" ")).toContain("not a printable replacement");
  });

  describe("smart thermostat catalog example", () => {
    it("provides a photo-backed planning draft with mapped checkpoints, not wiring instructions", () => {
      const guide = STARTER_GUIDES.find(item => item.slug === "smart-thermostat-installation");
      expect(guide).toBeDefined();
      if (!guide) throw new Error("Thermostat example is required.");
      expect(editableGuide.safeParse(guide).success).toBe(true);
      expect(guide.assemblyKind).toBe("thermostat");
      expect(guide.status).toBe("draft");
      expect(guide.duration).toContain("planning");
      const ids = PREVIEW_PARTS.thermostat.map(part => part.id);
      expect(ids).toHaveLength(5);
      for (const step of guide.steps) {
        expect(step.visual).toBeDefined();
        expect(step.partIds.length).toBeGreaterThan(0);
        for (const id of step.partIds) expect(ids).toContain(id);
      }
      expect(guide.steps.map(step => step.description).join(" ")).toContain("no terminal-to-wire assignments");
      expect(guide.stopConditions.join(" ")).toContain("Power isolation");
      expect(guide.stopConditions.join(" ")).toContain("Line-voltage");
      expect(GUIDE_PHOTOS[guide.slug]).toMatchObject({
        src: "/examples/smart-thermostat-installation.png", width: 1130, height: 832,
      });
    });
  });
});
