import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import PartsViewer from "./PartsViewer";
import type { AssemblyKind, ReviewedAssembly } from "@/lib/domain";
import { PREVIEW_PARTS } from "./parts";

vi.mock("next/dynamic", () => ({
  default: () => function MockCanvas() { return <div data-testid="canvas">3D canvas</div>; },
}));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("accessible viewer fallback and controls", () => {
  it("explodes, isolates, and restores the thermostat-specific diagram", () => {
    render(<PartsViewer kind="thermostat" immersive/>);
    const diagram = screen.getByRole("img", { name: /Illustrative thermostat diagram/ });
    const assembled = diagram.innerHTML;
    fireEvent.click(screen.getByRole("button", { name: "Explode view" }));
    expect(diagram.innerHTML).not.toBe(assembled);
    fireEvent.click(screen.getByRole("button", { name: "Unidentified conductors" }));
    fireEvent.click(screen.getByRole("button", { name: "Isolate part" }));
    expect(diagram.querySelectorAll('[opacity="0"]')).toHaveLength(4);
    expect(screen.getByText(/Unidentified conductors selected/)).toHaveTextContent("isolated");
    fireEvent.click(screen.getByRole("button", { name: "Reset assembly view" }));
    expect(diagram.innerHTML).toBe(assembled);
  });
  it.each(Object.keys(PREVIEW_PARTS) as AssemblyKind[])("uses the correct parts and controls for the immersive %s model", (kind) => {
    render(<PartsViewer kind={kind} immersive/>);
    const parts = PREVIEW_PARTS[kind];
    expect(screen.getByRole("img", { name: new RegExp(`Illustrative ${kind} diagram`) })).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(parts.length);
    for (const part of parts) {
      const hide = screen.getByRole("button", { name: `Hide ${part.label}` });
      fireEvent.click(hide);
      expect(screen.getByRole("button", { name: `Show ${part.label}` })).toHaveAttribute("aria-pressed", "false");
    }
    fireEvent.click(screen.getByRole("button", { name: "Reset assembly view" }));
    for (const part of parts) expect(screen.getByRole("button", { name: `Hide ${part.label}` })).toHaveAttribute("aria-pressed", "true");
  });
  it("collapses immersive controls without resetting the model", () => {
    render(<PartsViewer immersive overlay={<p>Tutorial overlay</p>}/>);
    expect(screen.getByRole("region", { name: "Interactive parts viewer" })).toBeInTheDocument();
    expect(screen.queryByText("A closer look")).not.toBeInTheDocument();
    expect(screen.queryByText("Understand the parts, without taking anything apart.")).not.toBeInTheDocument();
    expect(screen.queryByText(/^(INTERACTIVE 3D|PARTS VIEW)$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explode view" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide controls" }));
    expect(screen.queryByRole("button", { name: "Assemble view" })).not.toBeInTheDocument();
    expect(screen.getByText("Tutorial overlay")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show controls" }));
    expect(screen.getByRole("button", { name: "Assemble view" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps visibility toggles and the fallback diagram consistent during isolation", () => {
    render(<PartsViewer kind="knob"/>);
    fireEvent.click(screen.getByRole("button", { name: "Knob" }));
    fireEvent.click(screen.getByRole("button", { name: "Isolate part" }));
    expect(screen.getByRole("button", { name: "Show Fixing screw" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Hide Knob" }));
    const diagram = screen.getByRole("img");
    expect(diagram.querySelectorAll('[opacity="0"]')).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Show Fixing screw" }));
    expect(screen.getByRole("button", { name: "Isolate part" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Hide Fixing screw" })).toHaveAttribute("aria-pressed", "true");
    expect(diagram.querySelectorAll('[opacity="0"]')).toHaveLength(2);
  });
  it("shows washer-specific parts and an interactive fallback rather than a cabinet fitting", () => {
    render(<PartsViewer kind="washer-control"/>);
    const diagram = screen.getByRole("img", { name: /Illustrative washer-control diagram/ });
    const assembled = diagram.innerHTML;
    for (const part of PREVIEW_PARTS["washer-control"]) expect(screen.getByText(part.description)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fixing screw" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explode view" }));
    expect(diagram.innerHTML).not.toBe(assembled);
    fireEvent.click(screen.getByRole("button", { name: "Detached knob / replacement concept" }));
    fireEvent.click(screen.getByRole("button", { name: "Isolate part" }));
    expect(screen.getByText(/replacement concept selected/)).toHaveTextContent("isolated");
    fireEvent.click(screen.getByRole("button", { name: "Reset assembly view" }));
    expect(diagram.innerHTML).toBe(assembled);
  });
  it("decomposes the whole door into four selectable components without WebGL", () => {
    render(<PartsViewer kind="door" activePartIds={["door-panel"]}/>);
    const diagram = screen.getByRole("img", { name: /Illustrative door diagram/ });
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    const assembled = diagram.innerHTML;
    fireEvent.click(screen.getByRole("button", { name: "Explode view" }));
    expect(diagram.innerHTML).not.toBe(assembled);
    fireEvent.click(screen.getByRole("button", { name: "Handle" }));
    fireEvent.click(screen.getByRole("button", { name: "Isolate part" }));
    expect(screen.getByText(/Handle selected/)).toHaveTextContent("isolated");
    expect(screen.getByText(PREVIEW_PARTS.door[3].description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus part" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset assembly view" }));
    expect(diagram.innerHTML).toBe(assembled);
  });

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
    const knob = within(list).getByRole("button", { name: "Knob" });
    fireEvent.click(knob);
    expect(knob).toHaveAttribute("aria-pressed", "true");
    expect(onSelect).toHaveBeenCalledWith("knob-body");
    fireEvent.click(screen.getByRole("button", { name: "Isolate part" }));
    expect(screen.getByRole("button", { name: "Show all parts" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide Knob" }));
    expect(screen.getByRole("button", { name: "Show Knob" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show Knob" }));
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

  it("allows an explicitly labeled admin inspection without calling the draft reviewed", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ getExtension: () => null } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
    const assembly: ReviewedAssembly = { url: "/draft.glb", reviewed: false, parts: PREVIEW_PARTS.hinge };
    render(<PartsViewer assembly={assembly} reviewMode />);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByText("Unreviewed admin preview — not repair guidance")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("does not publish or approve");
    expect(screen.queryByText("Reviewed assembly")).not.toBeInTheDocument();
    expect(screen.queryByText(/A reviewed reference/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("resets selection when switching assembly kinds", () => {
    const { rerender } = render(<PartsViewer kind="hinge" />);
    fireEvent.click(screen.getByRole("button", { name: "Frame leaf" }));
    rerender(<PartsViewer kind="aerator" />);
    expect(screen.getByRole("button", { name: "Isolate part" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Outer housing" })).toHaveAttribute("aria-pressed", "false");
  });

  it("server renders a useful diagram without constructing WebGL", () => {
    const html = renderToString(<PartsViewer kind="aerator" />);
    expect(html).toContain("Illustrative preview");
    expect(html).toContain("Sealing washer");
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });
});
