import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import HomeIllustration from "./home-illustration";

vi.mock("next/dynamic", () => ({
  default: () => function MockCanvas({ onReady, onError, rotation }: {
    onReady: () => void; onError: (message: string) => void; rotation: number;
  }) {
    return <div data-testid="mascot-canvas" data-rotation={rotation}>
      <button onClick={onReady}>Finish loading mascot</button>
      <button onClick={() => onError("3D graphics are unavailable.")}>Fail mascot</button>
    </div>;
  },
}));

afterEach(cleanup);

it("loads the 3D mascot alongside the reassuring hero copy", () => {
  render(<HomeIllustration/>);

  expect(screen.getByRole("region", { name: "Muscular Handy Manny in 3D" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading Tripo 3D...");
  expect(screen.getByRole("img", {
    name: "Muscular 3D Handy Manny flexing and holding a red toolbox",
  })).toHaveAttribute("src", expect.stringContaining("handy-manny-3d.png"));
  for (const text of [
    "✦",
    "A little guidance.",
    "A lot more confidence.",
    "Your next small fix starts here.",
    "A happier home, one fix at a time.",
  ]) {
    expect(screen.getByText(text)).toBeVisible();
  }
});

it("enables rotation only after loading and resets the view", () => {
  render(<HomeIllustration/>);
  const right = screen.getByRole("button", { name: "Turn Handy Manny right" });
  expect(right).toBeDisabled();
  fireEvent.click(screen.getByText("Finish loading mascot"));
  expect(right).toBeEnabled();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  fireEvent.click(right);
  expect(Number(screen.getByTestId("mascot-canvas").dataset.rotation)).toBeCloseTo(Math.PI / 6);
  fireEvent.click(screen.getByRole("button", { name: "Turn Handy Manny left" }));
  expect(screen.getByTestId("mascot-canvas")).toHaveAttribute("data-rotation", "0");
  fireEvent.click(right);
  fireEvent.click(screen.getByRole("button", { name: "Reset Handy Manny view" }));
  expect(screen.getByTestId("mascot-canvas")).toHaveAttribute("data-rotation", "0");
  expect(screen.getByRole("status")).toHaveTextContent("Loading Tripo 3D...");
});

it("shows an explicit fallback on failure and allows retrying", () => {
  render(<HomeIllustration/>);
  fireEvent.click(screen.getByText("Fail mascot"));
  expect(screen.getByRole("status")).toHaveTextContent("3D graphics are unavailable. Showing the still image.");
  expect(screen.getByRole("img")).toBeVisible();
  expect(screen.queryByTestId("mascot-canvas")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry 3D" }));
  expect(screen.getByTestId("mascot-canvas")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading Tripo 3D...");
});
