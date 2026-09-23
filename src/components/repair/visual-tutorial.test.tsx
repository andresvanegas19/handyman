import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { STARTER_GUIDES } from "@/lib/catalog";
import type { PartsViewerProps } from "../viewer/PartsViewer";
import VisualTutorial from "./visual-tutorial";

vi.mock("next/dynamic", () => ({
  default: () => function MockViewer({ activePartIds, onPartSelect, overlay, immersive, stageControls }: PartsViewerProps) {
    return <div data-testid="viewer" data-active={activePartIds?.join(",")} data-immersive={immersive}>
      <button onClick={() => onPartSelect?.("hinge-pin")}>Select model pin</button>
      {overlay}
      {stageControls}
    </div>;
  },
}));
afterEach(cleanup);

describe("visual repair checkpoints", () => {
  it("overlays collapsible steps on the full-width reference without losing progress", () => {
    render(<VisualTutorial guide={STARTER_GUIDES[0]}/>);
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-immersive", "true");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Hide steps/ }));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show steps/ }));
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
  it("connects steps to highlighted parts and model selection back to steps", () => {
    render(<VisualTutorial guide={STARTER_GUIDES[0]}/>);
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-active", "door-hinges");
    expect(screen.getByRole("button", { name: "Whole door" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("viewer")).getByRole("group", { name: "Door model views" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hinge close-up" }));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-active", "hinge-frame,hinge-door");
    expect(screen.getByRole("button", { name: "Next checkpoint" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select model pin" }));
    fireEvent.click(screen.getByRole("button", { name: "Show step 2: Check the care guidance" }));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-active", "hinge-pin");
    expect(screen.getByRole("article", { name: "Visual checkpoint 2" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Next checkpoint" }));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-active", "hinge-pin,hinge-screws");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("does not invent movement or force for older guide steps", () => {
    render(<VisualTutorial guide={STARTER_GUIDES[0]}/>);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Visual tutorial steps" })).getByRole("button", { name: /2 Check the care guidance/ }));
    expect(screen.getByText(/No movement direction is specified/)).toBeInTheDocument();
    expect(screen.getByText(/No safe force is established/)).toBeInTheDocument();
  });

  it("keeps uncertainty paused across step navigation until an explicit reference restart", () => {
    render(<VisualTutorial guide={STARTER_GUIDES[0]}/>);
    fireEvent.click(screen.getByRole("button", { name: /My object looks different/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pause the physical repair.");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Visual tutorial steps" })).getByRole("button", { name: /2 Check the care guidance/ }));
    expect(screen.getByRole("button", { name: "Next checkpoint" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Restart reference-only exploration" }));
    expect(screen.getByRole("checkbox")).toBeEnabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("article", { name: "Visual checkpoint 1" })).toBeInTheDocument();
  });

  it("blocks unmapped references and never substitutes procedural geometry for missing published assets", () => {
    render(<VisualTutorial guide={{ ...STARTER_GUIDES[0], status: "published" }}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("required part is not mapped");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
    expect(screen.getByText(/No mapped 3D reference/)).toBeInTheDocument();
  });

  it("completes an educational walkthrough without claiming a physical repair", () => {
    render(<VisualTutorial guide={STARTER_GUIDES[0]}/>);
    for (let index = 0; index < STARTER_GUIDES[0].steps.length; index++) {
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: index === 3 ? "Finish checkpoint" : "Next checkpoint" }));
    }
    expect(screen.getByRole("status")).toHaveTextContent("does not mean your object is repaired");
    expect(screen.getByRole("button", { name: "Finish checkpoint" })).toBeDisabled();
  });

  it("resets progress for another revision and displays photo evidence without claiming alignment", () => {
    const { rerender } = render(<VisualTutorial guide={STARTER_GUIDES[0]} evidence={<span>User photo</span>}/>);
    expect(screen.getByText("User photo")).toBeInTheDocument();
    expect(screen.getByText(/No automatic part alignment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Next checkpoint" }));
    rerender(<VisualTutorial guide={{ ...STARTER_GUIDES[0], version: 2 }}/>);
    expect(screen.getByRole("article", { name: "Visual checkpoint 1" })).toHaveTextContent("0 explored");
  });
});
