import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useQuery } from "convex/react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import ProblemWorkspace, { InputRevision } from "./problem-workspace";

const {update,analyze,transcribe}=vi.hoisted(()=>({update:vi.fn(),analyze:vi.fn(),transcribe:vi.fn()}));
vi.mock("convex/react",()=>({useQuery:vi.fn(),useConvexAuth:()=>({isLoading:false,isAuthenticated:true}),useMutation:(reference:Parameters<typeof getFunctionName>[0])=>({"problems:update":update,"problems:analyze":analyze,"problems:transcribe":transcribe})[getFunctionName(reference)]}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn()})}));
vi.mock("@/lib/config",()=>({isConnected:true,hasConvex:true,visualRepairEnabled:false}));
const problem:Doc<"problems">={_id:"problem-one" as Id<"problems">,_creationTime:1,owner:"user",text:"A noisy hinge",consent:true,transcript:"The door squeaks.",transcriptConfirmed:false,revision:1,state:"awaiting_transcript",updatedAt:1};
beforeEach(()=>{vi.mocked(useQuery).mockReset();update.mockReset().mockResolvedValue(undefined);analyze.mockReset().mockResolvedValue("job");transcribe.mockReset().mockResolvedValue("job");});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("workspace revision identity",()=>{
  it("keeps editor and scene keys distinct while resetting both on a new revision",()=>{
    const consoleError=vi.spyOn(console,"error");
    const consoleInfo=vi.spyOn(console,"info").mockImplementation(()=>{});
    let currentProblem={...problem,revision:2};
    vi.mocked(useQuery).mockImplementation((...args)=>{
      const [reference]=args;
      if(getFunctionName(reference)==="problems:get") return {problem:currentProblem,media:[],analysis:null,feedback:[]};
      if(getFunctionName(reference)==="tripo:scene") return {configured:false,eligible:false,scene:null};
      return undefined;
    });
    const {rerender}=render(<ProblemWorkspace id={problem._id}/>);
    expect(screen.getByText("This repair uses the previous analysis workflow.")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Start a new photo + prompt visual repair"})).toHaveAttribute("href","/problems/new");
    expect(consoleInfo).toHaveBeenCalledWith("[repair]",expect.objectContaining({event:"workspace.state",problemId:problem._id,workflow:"legacy",phase:"awaiting_transcript",enabled:false}));
    const sceneHeading=screen.getByRole("heading",{name:"Your repair, in 3D."});
    fireEvent.change(screen.getByLabelText("Description & follow-up answers"),{target:{value:"Unsaved local edit"}});
    expect(consoleError).not.toHaveBeenCalled();

    currentProblem={...currentProblem,revision:3,text:"Updated saved description"};
    rerender(<ProblemWorkspace id={problem._id}/>);
    expect(screen.getByLabelText("Description & follow-up answers")).toHaveValue("Updated saved description");
    expect(screen.getByRole("heading",{name:"Your repair, in 3D."})).not.toBe(sceneHeading);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
describe("transcript confirmation",()=>{
  it("requires an explicit confirmation before analysis",async()=>{
    render(<InputRevision problem={problem} hasAudio hasPending={false} onError={vi.fn()}/>);
    expect(screen.getByRole("button",{name:"Save & request analysis"})).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Editable transcript"),{target:{value:"The interior door hinge squeaks."}});
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button",{name:"Save & request analysis"}));
    await waitFor(()=>expect(analyze).toHaveBeenCalledWith({problemId:problem._id}));
    expect(update).toHaveBeenCalledWith({problemId:problem._id,text:problem.text,transcript:"The interior door hinge squeaks.",transcriptConfirmed:true});
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(analyze.mock.invocationCallOrder[0]);
  });
  it("invalidates confirmation when the transcript changes",()=>{
    render(<InputRevision problem={{...problem,transcriptConfirmed:true}} hasAudio hasPending={false} onError={vi.fn()}/>);
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Editable transcript"),{target:{value:"Corrected description"}});
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button",{name:"Save & request analysis"})).toBeDisabled();
  });
  it("blocks analysis while uploads are incomplete",()=>{
    render(<InputRevision problem={problem} hasAudio={false} hasPending onError={vi.fn()}/>);
    expect(screen.getByRole("button",{name:"Save & request analysis"})).toBeDisabled();
    expect(screen.getByText(/Remove incomplete attachments/)).toBeInTheDocument();
  });
  it("persists an actionable error outside the revision editor",async()=>{
    analyze.mockRejectedValue(new Error("AI service is unavailable."));
    const onError=vi.fn();
    render(<InputRevision problem={problem} hasAudio={false} hasPending={false} onError={onError}/>);
    fireEvent.click(screen.getByRole("button",{name:"Save & request analysis"}));
    await waitFor(()=>expect(onError).toHaveBeenCalledWith("AI service is unavailable."));
  });
});
