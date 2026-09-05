import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import IntakeForm from "./intake-form";

beforeEach(()=>{
  let id=0;
  Object.defineProperty(URL,"createObjectURL",{configurable:true,value:vi.fn(()=>`blob:local-${++id}`)});
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("privacy-first intake",()=>{
  it("requires both a photo and written prompt with one upfront provider consent in visual mode",async()=>{
    const submit=vi.fn().mockResolvedValue(undefined);
    render(<IntakeForm workflow="visual" onSubmit={submit}/>);
    const button=screen.getByRole("button",{name:"Start visual repair"});
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(/OpenRouter and its underlying model provider/)).toHaveTextContent("automatic paid Tripo");
    expect(screen.queryByRole("button",{name:"Record a voice note"})).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Choose an audio file")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(/What's happening/),{target:{value:"  Loose handle  "}});
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Choose photos"),{target:{files:[new File(["x"],"handle.jpg",{type:"image/jpeg"})]}});
    fireEvent.change(screen.getByLabelText(/What's happening/),{target:{value:"   "}});
    expect(button).toBeDisabled();
    fireEvent.submit(screen.getByRole("form",{name:"Describe your repair"}));
    expect(screen.getByRole("alert")).toHaveTextContent("both a written description and a photo");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/What's happening/),{target:{value:"  Loose handle  "}});
    fireEvent.click(button);
    await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({text:"Loose handle",consent:true,audio:undefined})));
  });
  it("allows choosing the generation source before the single submission",async()=>{
    const submit=vi.fn().mockResolvedValue(undefined);
    render(<IntakeForm workflow="visual" onSubmit={submit}/>);
    const first=new File(["one"],"one.jpg",{type:"image/jpeg"});
    const second=new File(["two"],"two.jpg",{type:"image/jpeg"});
    fireEvent.change(screen.getByLabelText("Choose photos"),{target:{files:[first,second]}});
    fireEvent.change(screen.getByLabelText("Photo for automatic 3D generation"),{target:{value:"blob:local-2"}});
    fireEvent.change(screen.getByLabelText(/What's happening/),{target:{value:"Loose handle"}});
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button",{name:"Start visual repair"}));
    await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({photos:[second,first]})));
  });
  it("lets users type locally without pretending analysis is configured",()=>{
    render(<IntakeForm/>);
    fireEvent.change(screen.getByLabelText(/What's happening/),{target:{value:"My door squeaks"}});
    expect(screen.getByRole("button",{name:"Find my next step"})).toBeDisabled();
    expect(screen.getByText(/No AI service is configured/)).toBeInTheDocument();
  });
  it("requires consent and passes only explicit inputs to submission",async()=>{
    const submit=vi.fn().mockResolvedValue(undefined);
    render(<IntakeForm onSubmit={submit}/>);
    const button=screen.getByRole("button",{name:"Find my next step"});
    fireEvent.change(screen.getByLabelText(/What's happening/),{target:{value:"  My drawer sticks  "}});
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button);
    await waitFor(()=>expect(submit).toHaveBeenCalledWith({text:"My drawer sticks",photos:[],audio:undefined,consent:true}));
  });
  it("rejects unsupported photos and keeps them out of previews",()=>{
    const {container}=render(<IntakeForm/>);
    const input=container.querySelector('input[type="file"][multiple]')!;
    fireEvent.change(input,{target:{files:[new File(["x"],"bad.svg",{type:"image/svg+xml"})]}});
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG, or WebP");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("previews, removes, and revokes local photos",()=>{
    const {container,unmount}=render(<IntakeForm/>);
    const input=container.querySelector('input[type="file"][multiple]')!;
    fireEvent.change(input,{target:{files:[new File(["x"],"one.jpg",{type:"image/jpeg"}),new File(["x"],"two.png",{type:"image/png"})]}});
    expect(screen.getAllByRole("img")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button",{name:"Remove photo 1"}));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-1");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-2");
  });
  it("enforces the three-photo cap",()=>{
    const {container}=render(<IntakeForm/>);
    fireEvent.change(container.querySelector('input[type="file"][multiple]')!,{target:{files:Array.from({length:4},(_,i)=>new File(["x"],`${i}.jpg`,{type:"image/jpeg"}))}});
    expect(screen.getByRole("alert")).toHaveTextContent("up to three photos");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("surfaces submission errors instead of displaying a fabricated result",async()=>{
    render(<IntakeForm onSubmit={vi.fn().mockRejectedValue(new Error("Analysis service is not configured."))}/>);
    fireEvent.change(screen.getByLabelText(/What's happening/),{target:{value:"A squeaky hinge"}});
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button",{name:"Find my next step"}));
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Analysis service is not configured."));
  });
  it("offers alternatives when recording is unsupported",()=>{
    render(<IntakeForm/>);
    fireEvent.click(screen.getByRole("button",{name:"Record a voice note"}));
    expect(screen.getByRole("alert")).toHaveTextContent("Upload an audio file or use text");
  });
  it("opens attachment choices and returns focus when dismissed with Escape",()=>{
    render(<IntakeForm/>);
    const toggle=screen.getByRole("button",{name:"Add attachments"});
    expect(toggle).toHaveAttribute("aria-expanded","false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded","true");
    expect(screen.getByRole("button",{name:/Upload audio/})).toBeInTheDocument();
    fireEvent.keyDown(document,{key:"Escape"});
    expect(screen.queryByRole("group",{name:"Attachment options"})).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });
  it("opens the photo picker from the compact attachment choices",()=>{
    render(<IntakeForm/>);
    const pick=vi.spyOn(screen.getByLabelText("Choose photos"),"click");
    fireEvent.click(screen.getByRole("button",{name:"Add attachments"}));
    fireEvent.click(screen.getByRole("button",{name:/^Add photos/}));
    expect(pick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button",{name:"Add attachments"})).toHaveAttribute("aria-expanded","false");
  });
  it("supports Enter to submit without bypassing consent or composition",async()=>{
    const submit=vi.fn().mockResolvedValue(undefined);
    render(<IntakeForm onSubmit={submit}/>);
    const input=screen.getByLabelText(/What's happening/);
    fireEvent.change(input,{target:{value:"A loose handle"}});
    fireEvent.keyDown(input,{key:"Enter"});
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.keyDown(input,{key:"Enter",shiftKey:true});
    fireEvent.keyDown(input,{key:"Enter",isComposing:true});
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input,{key:"Enter"});
    await waitFor(()=>expect(submit).toHaveBeenCalledOnce());
  });
  it("keeps the composer without the redundant suggestion shortcuts",()=>{
    render(<IntakeForm/>);
    expect(screen.queryByRole("button",{name:"Add a photo of the problem"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Describe what needs fixing"})).not.toBeInTheDocument();
    expect(screen.queryByText("Repair help")).not.toBeInTheDocument();
    const input=screen.getByLabelText(/What's happening/);
    expect(input).toHaveValue("");
  });
  it("focuses the attachment menu for photo entry links",()=>{
    const previousUrl=window.location.href;
    window.history.replaceState(null,"","?input=photo");
    try {
      render(<IntakeForm/>);
      expect(screen.getByRole("button",{name:"Add attachments"})).toHaveFocus();
    } finally {
      window.history.replaceState(null,"",previousUrl);
    }
  });
});
