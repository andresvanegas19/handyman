import type { AssemblyKind, AssemblyPart } from "@/lib/domain";

export const PREVIEW_PARTS: Record<AssemblyKind, AssemblyPart[]> = {
  hinge: [
    { id: "hinge-frame", label: "Frame leaf", description: "The plate attached to the frame. Generic illustration only.", nodeNames: ["hinge-frame"], explodeOffset: [-1.15, 0, 0] },
    { id: "hinge-door", label: "Door leaf", description: "The plate attached to the door. Shape and fixings vary.", nodeNames: ["hinge-door"], explodeOffset: [1.15, 0, 0] },
    { id: "hinge-pin", label: "Hinge pin", description: "The illustrated pivot. Exploding this model is not an instruction to remove it.", nodeNames: ["hinge-pin"], explodeOffset: [0, 1.3, 0] },
    { id: "hinge-screws", label: "Fixing screws", description: "A group of visible fixings. Do not loosen door-supporting hardware.", nodeNames: ["hinge-screws"], explodeOffset: [0, 0, 1.15] },
  ],
  knob: [
    { id: "knob-body", label: "Knob", description: "The part held by hand. This is an illustrative shape, not a measured replacement.", nodeNames: ["knob-body"], explodeOffset: [0, 0, 1.15] },
    { id: "knob-washer", label: "Washer", description: "An example of a load-spreading washer. Your fitting may not use one.", nodeNames: ["knob-washer"], explodeOffset: [0, 0, 0.1] },
    { id: "knob-screw", label: "Fixing screw", description: "A generic rear fixing. The correct length and thread depend on the hardware.", nodeNames: ["knob-screw"], explodeOffset: [0, 0, -1.3] },
  ],
  aerator: [
    { id: "aerator-housing", label: "Outer housing", description: "An example of an outlet housing; not all faucets use this design.", nodeNames: ["aerator-housing"], explodeOffset: [0, -0.65, 0] },
    { id: "aerator-screen", label: "Flow screen", description: "An illustrative screen. Actual inserts can contain several nested components.", nodeNames: ["aerator-screen"], explodeOffset: [0, 0.6, 0] },
    { id: "aerator-gasket", label: "Sealing washer", description: "An illustrative seal above the screen. Follow the exact manufacturer's component order.", nodeNames: ["aerator-gasket"], explodeOffset: [0, 1.3, 0] },
  ],
};
