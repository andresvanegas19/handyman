import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import PartsViewer from "./PartsViewer";
import type { ReviewedAssembly } from "@/lib/domain";
import { PREVIEW_PARTS } from "./parts";

vi.mock("next/dynamic", () => ({
  default: () => function MockCanvas() { return <div data-testid="canvas">3D canvas</div>; },
}));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("accessible viewer fallback and controls", () => {
  it("provides an explicit illustrative diagram and all part descriptions without WebGL", () => {
    render(<PartsViewer />);
    expect(screen.getByText("Illustrative preview · not a Tripo model")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Illustrative hinge diagram/ })).toBeInTheDocument();
    expect(screen.getByText(/3D is unavailable in this browser/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    for (const part of PREVIEW_PARTS.hinge) expect(screen.getByText(part.description)).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it("supports part selection, isolation, hide/show, explode, and deterministic reset", () => {
    const onSelect = vi.fn();
    render(<PartsViewer kind="knob" onPartSelect={onSelect} activePartIds={["knob-screw"]} />);
    expect(screen.getByRole("button", { name: "Isolate part" })).toBeDisabled();
    const list = screen.getByRole("list", { name: "Assembly parts" });
    const knob = within(list).getByRole("button", { name: "Knob", exact: true });
    fireEvent.click(knob);
    expect(knob).toHaveAttribute("aria-pressed", "true");
    expect(onSelect).toHaveBeenCalledWith("knob-body");
    fireEvent.click(screen.getByRole("button", { name: "Isolate part" }));
    expect(screen.getByRole("button", { name: "Show all parts" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide Knob", exact: true }));
    expect(screen.getByRole("button", { name: "Show Knob", exact: true })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show Knob", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Explode view" }));
    expect(screen.getByRole("button", { name: "Assemble view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("In this step")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset assembly view" }));
    expect(screen.getByRole("button", { name: "Explode view" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Isolate part" })).toBeDisabled();
    expect(knob).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses unreviewed assets without silently substituting a procedural model", () => {
    const assembly: ReviewedAssembly = { url: "/draft.glb", reviewed: false, parts: PREVIEW_PARTS.hinge };
    render(<PartsViewer assembly={assembly} />);
    expect(screen.getByRole("alert")).toHaveTextContent("has not been reviewed");
    expect(screen.getByText("No substitute model is shown.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("Illustrative preview · not a Tripo model")).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it("keeps reviewed metadata available without WebGL and reports unmapped step IDs", () => {
    render(<PartsViewer assembly={{ url: "/reviewed.glb", reviewed: true, parts: PREVIEW_PARTS.aerator }} activePartIds={["missing-node"]} />);
    expect(screen.getByText("Reviewed assembly")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("not mapped");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(PREVIEW_PARTS.aerator[0].description)).toBeInTheDocument();
  });

  it("resets selection when switching assembly kinds", () => {
    const { rerender } = render(<PartsViewer kind="hinge" />);
    fireEvent.click(screen.getByRole("button", { name: "Frame leaf", exact: true }));
    rerender(<PartsViewer kind="aerator" />);
    expect(screen.getByRole("button", { name: "Isolate part" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Outer housing", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  it("server renders a useful diagram without constructing WebGL", () => {
    const html = renderToString(<PartsViewer kind="aerator" />);
    expect(html).toContain("Illustrative preview");
    expect(html).toContain("Sealing washer");
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });
});
