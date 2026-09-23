import type { AssemblyKind, AssemblyPart } from "@/lib/domain";

export const PREVIEW_PARTS: Record<AssemblyKind, AssemblyPart[]> = {
  thermostat: [
    { id: "thermostat-trim", label: "Wall trim plate", description: "The rectangular plate behind the base. It covers the wall surface; hidden wiring and mounting conditions are not reconstructed.", nodeNames: ["thermostat-trim"], explodeOffset: [0, 0, -0.7] },
    { id: "thermostat-base", label: "Thermostat mounting base", description: "A generic round support for the thermostat. The display is absent in the supplied image and is not modeled.", nodeNames: ["thermostat-base"], explodeOffset: [0, 0, -0.1] },
    { id: "thermostat-terminals", label: "Terminal blocks", description: "Illustrative connection blocks, not a wiring diagram. Exact labels and verified conductor functions must come from manufacturer documentation and a qualified installer.", nodeNames: ["thermostat-terminals"], explodeOffset: [1.1, 0, 0.45] },
    { id: "thermostat-wires", label: "Unidentified conductors", description: "A neutral-colored wire bundle with no assigned electrical functions. Color, appearance, and this photo cannot confirm voltage, a C-wire, or safe connections. Do not touch exposed conductors.", nodeNames: ["thermostat-wires"], explodeOffset: [-0.9, 0, 1.05] },
    { id: "thermostat-screws", label: "Mounting screws", description: "Two illustrative base fixings. Screw size, wall anchors, tightening limits, and safe drilling locations are not established by the model.", nodeNames: ["thermostat-screws"], explodeOffset: [0, 0.55, 0.8] },
  ],
  "washer-control": [
    { id: "washer-panel", label: "Control panel", description: "An illustrative backdrop for the washer controls. Internal wiring and the timer mechanism are not modeled; do not open the console.", nodeNames: ["washer-panel"], explodeOffset: [0, 0, -0.65] },
    { id: "washer-dial", label: "Timer dial", description: "The circular dial visible around the central shaft in the photo. Its markings and dimensions are illustrative; do not pry it off.", nodeNames: ["washer-dial"], explodeOffset: [-0.65, 0, 0.1] },
    { id: "washer-shaft", label: "Exposed control shaft", description: "A simplified marker for the visible shaft, not a specification of its thread, profile, or retention hardware. Do not turn it with pliers or force a print onto it.", nodeNames: ["washer-shaft"], explodeOffset: [0, 0, 0.55] },
    { id: "washer-knob", label: "Detached knob / replacement concept", description: "An illustrative outer grip inspired by the detached black knob. No socket, thread, or retainer is engineered here. Exact measurements and qualified review are required before any real replacement is fabricated.", nodeNames: ["washer-knob"], explodeOffset: [0.8, 0, 1.35] },
  ],
  door: [
    { id: "door-frame", label: "Door frame", description: "The stationary surround: two upright sides and a top rail. This illustration does not show the wall or hidden fixings.", nodeNames: ["door-frame"], explodeOffset: [-1.2, 0, -0.35] },
    { id: "door-panel", label: "Door panel", description: "The broad wooden piece that moves. The recessed rectangles are decorative panels, not removable covers.", nodeNames: ["door-panel"], explodeOffset: [0.45, 0, 0.8] },
    { id: "door-hinges", label: "Hinges", description: "Three illustrated brass pivots along the left edge connect the door to its frame. Never loosen hardware supporting a door.", nodeNames: ["door-hinges"], explodeOffset: [-0.55, 0, 1.1] },
    { id: "door-handle", label: "Handle", description: "The visible brass lever on the opposite edge. Its hidden latch and internal mechanism are not modeled and cannot be inferred.", nodeNames: ["door-handle"], explodeOffset: [1.25, 0, 1.15] },
  ],
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
