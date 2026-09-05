import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import RepairPipeline from "./repair-pipeline";

afterEach(cleanup);

it("shows all six stages without claiming unavailable AI or reconstruction", () => {
  render(<RepairPipeline hasPhoto assessed={false} hasPlan={false} hasModel={false} guiding temporary/>);
  expect(within(screen.getByRole("list", { name: "Photo to visual repair workflow" })).getAllByRole("listitem")).toHaveLength(6);
  expect(screen.getByText("AI unavailable in temporary mode")).toBeInTheDocument();
  expect(screen.getByText("Exact reconstruction unavailable")).toBeInTheDocument();
  expect(screen.getByText("Reference exploration only")).toBeInTheDocument();
  expect(screen.getByText("No reviewed plan selected")).toBeInTheDocument();
});

it("labels connected model availability as a reference rather than an exact reconstruction", () => {
  render(<RepairPipeline hasPhoto assessed hasPlan hasModel guiding/>);
  expect(screen.getByText("Reviewed reference available")).toBeInTheDocument();
  expect(screen.getByText("A catalog model is not a reconstruction of your photo.")).toBeInTheDocument();
});
