import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuestSessionProvider, GuestSessionStatus } from "./guest-session";

const state = vi.hoisted(() => ({
  start: vi.fn(),
  auth: { isAuthenticated: false, isLoading: false },
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: state.start }) }));
vi.mock("convex/react", () => ({ useConvexAuth: () => state.auth }));

beforeEach(() => {
  state.start.mockReset().mockResolvedValue({ signingIn: true });
  state.auth.isAuthenticated = false;
  state.auth.isLoading = false;
});
afterEach(cleanup);

describe("automatic anonymous sessions", () => {
  it("starts once without asking for an account, including StrictMode remounts", async () => {
    render(<StrictMode><GuestSessionProvider><GuestSessionStatus/></GuestSessionProvider></StrictMode>);
    await waitFor(() => expect(state.start).toHaveBeenCalledExactlyOnceWith("anonymous"));
    expect(screen.getByText("No account or sign-in needed.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /sign in|log in|register/i })).not.toBeInTheDocument();
  });

  it("reuses an existing session without creating a new guest", () => {
    state.auth.isAuthenticated = true;
    render(<GuestSessionProvider><p>Your repair workspace</p></GuestSessionProvider>);
    expect(state.start).not.toHaveBeenCalled();
  });

  it("surfaces failures and allows an explicit connection retry", async () => {
    state.start.mockRejectedValueOnce(new Error("Backend unavailable."));
    render(<GuestSessionProvider><GuestSessionStatus/></GuestSessionProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not start");
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    await waitFor(() => expect(state.start).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
