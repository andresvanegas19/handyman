import React from "react";
import { createRoot } from "react-dom/client";
import type { Id } from "../../convex/_generated/dataModel";
import { Header } from "../../src/components/site-shell";
import VisualRepairWorkspace from "../../src/components/repair/visual-repair-workspace";
import IntakeForm from "../../src/components/intake/intake-form";
import "../../src/app/globals.css";
import { recordCall } from "./store.fixture";

const root = document.getElementById("root");
if (!root) throw new Error("The browser fixture root is missing.");

createRoot(root).render(<React.StrictMode>
  <Header/>
  <main id="main">
    {new URLSearchParams(window.location.search).get("mode") === "intake"
      ? <div className="container page-section"><IntakeForm workflow="visual" onSubmit={async data => {
          recordCall("visual-intake", { text: data.text, photos: data.photos.length, consent: data.consent });
        }}/></div>
      : <VisualRepairWorkspace problemId={"visual-fixture" as Id<"problems">}/>}
  </main>
</React.StrictMode>);
