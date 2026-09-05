import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { STARTER_GUIDES } from "@/lib/catalog";
import GuideDetail, { PreviewGuide } from "./guide-detail";

const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("convex/react",()=>({useQuery:query}));
vi.mock("@/lib/config",()=>({hasConvex:true}));
vi.mock("next/dynamic",()=>({default:()=>()=>null}));
const versionId="saved-guide-version";
const result={guide:{...STARTER_GUIDES[0],status:"published",_id:versionId},assembly:null,counts:{worked:0,partly:0,not_worked:0,total:0}};
beforeEach(()=>{query.mockReset().mockImplementation((reference:Parameters<typeof getFunctionName>[0],args:unknown)=>args==="skip"?undefined:getFunctionName(reference)==="catalog:version"?result:null);});
afterEach(cleanup);
describe("explicit example pages",()=>{
  it("opens a labeled draft even with a connected, empty catalog",()=>{
    render(<PreviewGuide slug={STARTER_GUIDES[0].slug}/>);
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent(STARTER_GUIDES[0].title);
    expect(screen.getByText("For exploration, not repair instructions.")).toBeInTheDocument();
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
