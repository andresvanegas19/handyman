import { v, type Infer } from "convex/values";
import type { Recognition, Research } from "./repairContracts";
import { publicHttpsUrl } from "./firecrawl";

export const recommendationsValidator = v.object({
  summary: v.string(), urgent: v.boolean(),
  items: v.array(v.object({ title: v.string(), description: v.string() })),
  questions: v.array(v.string()),
  sources: v.array(v.object({ url: v.string(), title: v.string() })),
  identification: v.optional(v.object({
    product: v.string(), brand: v.string(), model: v.string(), confidence: v.number(),
  })),
  visionModel: v.optional(v.string()),
  imageDescription: v.optional(v.string()),
  visibleFeatures: v.optional(v.array(v.string())),
});

const normalized = (text: string) => text.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();

export function needsImmediateSafety(text: string, recognition?: Recognition) {
  const evidence = normalized([text, recognition?.product, recognition?.symptom, ...(recognition?.features ?? [])].join(" "));
  return /\b(gas leak|smell of gas|gas smell|smell(?:ing)? gas|carbon monoxide|sparks?|smoke|burning smell|swollen batter(?:y|ies)|live wir(?:e|es|ing)|mains voltage|structural (?:damage|collapse)|flooding)\b/.test(evidence);
}

export function repairRecommendations(
  text: string, recognition?: Recognition, research?: Research, visionModel?: string,
): Infer<typeof recommendationsValidator> {
  const urgent = needsImmediateSafety(text, recognition);
  const evidence = normalized([recognition?.product, recognition?.symptom, text].join(" "));
  const sources = (research?.sources ?? []).flatMap(source => {
    const url = publicHttpsUrl(source.url);
    return url ? [{ url, title: source.title }] : [];
  });
  const identification = recognition?.product.trim() && recognition.confidence > 0 ? {
    product: recognition.product, brand: recognition.brand, model: recognition.model,
    confidence: Math.max(0, Math.min(1, recognition.confidence)),
  } : undefined;
  const actualVisionModel = visionModel && !["deterministic-safety-screen", "local-safety-screen"].includes(visionModel) ? visionModel : undefined;
  const result: Infer<typeof recommendationsValidator> = {
    urgent, sources, identification,
    visionModel: actualVisionModel,
    imageDescription: actualVisionModel ? recognition?.imageDescription : undefined,
    visibleFeatures: actualVisionModel && recognition ? recognition.features.filter(feature => feature.trim()) : undefined,
    summary: identification
      ? "Use the tentative object identification to review relevant documentation and decide what to do next. These recommendations do not depend on 3D readiness and are not a confirmed diagnosis."
      : "The object has not been reliably identified yet. You can still use these next steps while gathering the missing information.",
    items: [], questions: [],
  };
  if (urgent) {
    result.items = [
      { title: "Prioritize immediate safety", description: "If the reported danger is present, move away to safety and contact local emergency services or the relevant utility. Do not approach the object to take another photo." },
      { title: "Avoid testing or disassembly", description: "Do not touch suspect wiring, open covers, operate switches near a suspected gas leak, or run the equipment to reproduce the problem." },
      { title: "Prepare a remote handoff", description: "From a safe location, share the description, existing photos, and any model information already available with the responder or qualified service provider." },
    ];
    return result;
  }

  const appliance = /\b(appliance|dishwasher|washing machine|washer|dryer|oven|refrigerator|freezer|microwave|toaster|kettle)\b/.test(evidence);
  const gasOrHeating = /\b(gas|boiler|furnace|heater)\b/.test(evidence);
  const electrical = /\b(electrical|electricity|wiring|wires?|outlet|socket|breaker|battery|thermostat)\b/.test(evidence);
  const thermostat = /\bthermostat\b/.test(evidence);
  const plumbing = /\b(faucet|tap|sink|toilet|pipe|plumbing|leak|drip|dripping|drain)\b/.test(evidence);
  const furniture = /\b(cabinet|drawer|cupboard|wardrobe|dresser|handle|knob|hinge)\b/.test(evidence);
  result.items.push({
    title: "Confirm the product and its documentation",
    description: "Compare the tentative identification with the model name in your existing manual, receipt, or safely visible label. Do not move equipment or remove a cover to find it.",
  });
  if (thermostat) {
    result.items.push(
      { title: "Check thermostat and HVAC compatibility", description: "Use the exact thermostat and HVAC model documentation to check supported control voltage, system type, and any C-wire or approved accessory requirements. Wire colors and a photograph do not establish compatibility or safe connections." },
      { title: "Prepare an installation assessment", description: "Share existing terminal records and the intended thermostat model with a qualified HVAC installer. Do not touch, rearrange, or test exposed conductors or copy tool use from a reference image." },
    );
    result.questions = ["Which thermostat and HVAC models are listed in your existing documentation?", "Are you planning an upgrade, or is an installed thermostat malfunctioning? Describe any error already visible without operating it."];
  } else if (gasOrHeating) {
    result.items.push({ title: "Use the appropriate service route", description: "Review the exact model's service and warranty documentation and arrange a qualified gas or heating technician. Do not attempt ignition, adjustment, or disassembly to gather more information. If you smell gas, leave the area and contact the utility or emergency services from a safe location." });
    result.questions = ["What model is listed in your existing documentation?", "What symptom or error was already visible before you stopped using it?"];
  } else if (appliance) {
    result.items.push(
      { title: "Look up the displayed error or symptom", description: "Use the exact model's manufacturer documentation to interpret an error already on the display. Record when it appeared and what changed beforehand; do not run the appliance again just to reproduce it." },
      { title: "Check service and warranty options", description: "Review the manufacturer's support and warranty information before buying parts. Internal, powered, or sealed components need an appliance service technician rather than photo-based disassembly instructions." },
    );
    result.questions = ["What brand and model are shown in your existing documentation?", "What exact error code or visible symptom appeared, and when did it begin?"];
  } else if (electrical) {
    result.items.push({ title: "Arrange an electrical assessment", description: "Record the visible symptom without touching or testing the affected equipment. Share existing photos and model information with a licensed electrician or the manufacturer's service team; a photo cannot confirm that a circuit or battery is safe." });
    result.questions = ["What device is affected and what symptom did you observe before stopping use?", "Is its model or an existing error message available without handling the equipment?"];
  } else if (plumbing) {
    result.items.push({ title: "Document the visible leak pattern", description: "Describe where water was visible and whether the issue was constant or only occurred during normal use. Check the matching manufacturer's troubleshooting information; concealed, pressurized, or ongoing leaks need a plumber's assessment." });
    result.questions = ["Where is the water or blockage visible without moving or dismantling anything?", "Was the problem constant or only noticeable during normal use?"];
  } else if (furniture) {
    result.items.push({ title: "Clarify the visible hardware", description: "If safe, provide an overview and a close-up of the affected handle, hinge, or knob in its current position. Note visible cracks, gaps, or looseness without pulling on it or removing parts; hidden fasteners cannot be established from a photo." });
    result.questions = ["Which visible part is affected, and is there any visible cracking or damage?", "Can the relevant hardware be seen in its current position without moving or removing parts?"];
  } else {
    result.items.push({ title: "Narrow down the symptom", description: "Describe what changed, when it started, and anything already visible. If safe, use one overview photo and one close-up without moving, operating, or dismantling the object." });
    result.questions = ["What is the object used for, and which visible part is affected?", "What changed, and when did the symptom first appear?"];
  }
  result.items.push({
    title: sources.length ? "Review the retrieved sources" : "Find the matching manufacturer guidance",
    description: sources.length
      ? "Use the source links below to check product identity, prerequisites, and service options. Search matches are references, not confirmation that a procedure applies to your object."
      : "No supporting source has been retrieved yet. Look for the exact model on the manufacturer's support site; do not treat a similar-looking product or a generated shape as a parts match.",
  });
  return result;
}
