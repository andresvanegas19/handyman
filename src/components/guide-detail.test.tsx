import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { STARTER_GUIDES } from "@/lib/catalog";
import GuideDetail, { PreviewGuide } from "./guide-detail";

const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("convex/react",()=>({useQuery:query}));
vi.mock("@/lib/config",()=>({hasConvex:true}));
vi.mock("next/dynamic",()=>({default:()=>function MockViewer(){return <div data-testid="viewer"/>;}}));
const versionId="saved-guide-version";
const result={guide:{...STARTER_GUIDES[0],status:"published",_id:versionId},assembly:null,counts:{worked:0,partly:0,not_worked:0,total:0}};
beforeEach(()=>{query.mockReset().mockImplementation((reference:Parameters<typeof getFunctionName>[0],args:unknown)=>args==="skip"?undefined:getFunctionName(reference)==="catalog:version"?result:null);});
afterEach(cleanup);
describe("explicit example pages",()=>{
  it("opens the thermostat planning example with the correct reference photo proportions",()=>{
    render(<PreviewGuide slug="smart-thermostat-installation"/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent("Installing a Smart Thermostat? Here's What You Need to Know");
    const photo=screen.getByRole("img",{name:/Round smart-thermostat base/});
    expect(photo).toHaveAttribute("width","1130");
    expect(photo).toHaveAttribute("height","832");
    expect(screen.getByRole("link",{name:"Open full-size reference photo"})).toHaveAttribute("href","/examples/smart-thermostat-installation.png");
    expect(screen.getByText("15-20 min planning")).toBeInTheDocument();
    expect(screen.getByText("Version 1 · Draft preview")).toBeInTheDocument();
    expect(query).not.toHaveBeenCalled();
  });
  it("places the guide details and tutorial introduction below the viewer",()=>{
    render(<PreviewGuide slug={STARTER_GUIDES[0].slug}/>);
    const viewer=screen.getByTestId("viewer");
    expect(screen.getByRole("heading",{level:1}).compareDocumentPosition(viewer)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for(const element of [
      screen.getByText(STARTER_GUIDES[0].summary),
      screen.getByText(STARTER_GUIDES[0].duration),
      screen.getByText(STARTER_GUIDES[0].difficulty),
      screen.getByText("Version 1 · Draft preview"),
      screen.getByText("Applicability, tools, and stop conditions"),
      screen.getByRole("heading",{name:"One step at a time"}),
      screen.getByText("Check applicability and stop conditions"),
    ]) expect(viewer.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("opens the photo-based washer walkthrough without publishing it",()=>{
    render(<PreviewGuide slug="washing-machine-control-knob"/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent("A second chance for a washing-machine knob");
    expect(screen.getByRole("img",{name:/Washing-machine timer dial/})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Open full-size reference photo"})).toHaveAttribute("href","/examples/washing-machine-control-knob.png");
    expect(screen.getByText(/photo does not establish the failure/)).toBeInTheDocument();
    expect(screen.getByText("Version 1 · Draft preview")).toBeInTheDocument();
    expect(query).not.toHaveBeenCalled();
  });
  it("opens a labeled draft even with a connected, empty catalog",()=>{
    render(<PreviewGuide slug={STARTER_GUIDES[0].slug}/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent(STARTER_GUIDES[0].title);
    expect(screen.queryByText("For exploration, not repair instructions.")).not.toBeInTheDocument();
    expect(screen.queryByText(/A qualified reviewer must approve applicability and safety/)).not.toBeInTheDocument();
    expect(screen.getByText("Version 1 · Draft preview")).toBeInTheDocument();
    expect(query).not.toHaveBeenCalled();
  });
  it("does not invent an example for an unknown slug",()=>{
    render(<PreviewGuide slug="unknown-example"/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent("We couldn't find that guide.");
    expect(query).not.toHaveBeenCalled();
  });
});
describe("exact historical guide revisions",()=>{
  it("loads the stored version instead of silently querying the newest guide",()=>{
    render(<GuideDetail slug={STARTER_GUIDES[0].slug} versionId={versionId}/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent(STARTER_GUIDES[0].title);
    expect(query.mock.calls.some(([reference,args])=>getFunctionName(reference)==="catalog:version"&&args.guideVersionId===versionId)).toBe(true);
    expect(query.mock.calls.some(([reference,args])=>getFunctionName(reference)==="catalog:detail"&&args==="skip")).toBe(true);
    expect(screen.getByText(/Viewing the exact published guide revision/)).toBeInTheDocument();
  });
  it("does not substitute a current guide when a version is withdrawn",()=>{
    query.mockImplementation((_reference:unknown,args:unknown)=>args==="skip"?undefined:null);
    render(<GuideDetail slug={STARTER_GUIDES[0].slug} versionId={versionId}/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent("This guide isn't available.");
    expect(screen.queryByText("One step at a time")).not.toBeInTheDocument();
  });
  it("rejects a version ID paired with another guide's slug",()=>{
    render(<GuideDetail slug="different-guide" versionId={versionId}/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent("This guide link doesn't match.");
  });
});
