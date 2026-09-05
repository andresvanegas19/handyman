import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "../../../convex/_generated/dataModel";
import Feedback from "./feedback";

const {save}=vi.hoisted(()=>({save:vi.fn()}));
vi.mock("convex/react",()=>({useMutation:()=>save}));
const problemId="problem-one" as Id<"problems">;
const guideVersionId="guide-one" as Id<"guideVersions">;
beforeEach(()=>{save.mockReset().mockResolvedValue("saved");});
afterEach(cleanup);
describe("version-linked feedback",()=>{
  it("saves the selected outcome and optional private comment against the exact revision",async()=>{
    render(<Feedback problemId={problemId} guideVersionId={guideVersionId}/>);
    expect(screen.getByRole("button",{name:"Save outcome"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Partly worked"}));
    fireEvent.change(screen.getByLabelText(/Anything you'd like to add/),{target:{value:"The wobble improved."}});
    fireEvent.click(screen.getByRole("button",{name:"Save outcome"}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith({problemId,guideVersionId,outcome:"partly",comment:"The wobble improved."}));
    expect(await screen.findByRole("status")).toHaveTextContent("Your outcome is saved");
  });
  it("loads an existing answer for updating rather than inventing a new count",()=>{
    render(<Feedback problemId={problemId} guideVersionId={guideVersionId} previous={{outcome:"worked",comment:"Quiet now"}}/>);
    expect(screen.getByRole("button",{name:"Worked"})).toHaveAttribute("aria-pressed","true");
    expect(screen.getByRole("button",{name:"Update outcome"})).toBeEnabled();
    expect(screen.getByRole("textbox")).toHaveValue("Quiet now");
  });
  it("shows a server failure without claiming feedback was saved",async()=>{
    save.mockRejectedValue(new Error("This guide is not eligible for feedback."));
    render(<Feedback problemId={problemId} guideVersionId={guideVersionId}/>);
    fireEvent.click(screen.getByRole("button",{name:"Did not work"}));
    fireEvent.click(screen.getByRole("button",{name:"Save outcome"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("not eligible");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
