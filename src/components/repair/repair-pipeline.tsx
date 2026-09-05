import styles from "./repair-pipeline.module.css";

export default function RepairPipeline({ hasPhoto, assessed, hasPlan, hasModel, guiding, temporary = false }: {
  hasPhoto: boolean;
  assessed: boolean;
  hasPlan: boolean;
  hasModel: boolean;
  guiding: boolean;
  temporary?: boolean;
}) {
  const stages = [
    { title: "Photo", status: hasPhoto ? "Photo supplied" : "No photo supplied", detail: "A visible observation, not evidence of hidden components.", ready: hasPhoto },
    { title: "Diagnose", status: assessed ? "Tentative assessment available" : temporary ? "AI unavailable in temporary mode" : "Awaiting assessment", detail: "Confirm applicability; a suggestion is not a diagnosis.", ready: assessed },
    { title: "Reconstruct", status: hasModel ? "Reviewed reference available" : "Exact reconstruction unavailable", detail: "A catalog model is not a reconstruction of your photo.", ready: hasModel },
    { title: "Generate repair plan", status: hasPlan ? "Catalog guidance selected" : "No reviewed plan selected", detail: "Use reviewed steps, not invented instructions.", ready: hasPlan },
    { title: "Visualize in 3D", status: hasModel ? "Reviewed parts ready" : guiding ? "Reference exploration only" : "Awaiting a matching reference", detail: "Separate, select, and isolate mapped parts.", ready: hasModel },
    { title: "Guide user", status: guiding ? "Visual walkthrough open" : "Awaiting guide selection", detail: "Identify each part and pause when anything differs.", ready: guiding },
  ];
  return <ol className={styles.pipeline} aria-label="Photo to visual repair workflow">
    {stages.map((stage, index) => <li key={stage.title} data-ready={stage.ready}>
      <span className={styles.number}>{index + 1}</span>
      <h3>{stage.title}</h3><strong>{stage.status}</strong><p>{stage.detail}</p>
    </li>)}
  </ol>;
}
