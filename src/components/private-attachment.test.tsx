import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "../../convex/_generated/dataModel";
import PrivateAttachment from "./private-attachment";

const {getToken}=vi.hoisted(()=>({getToken:vi.fn()}));
vi.mock("@convex-dev/auth/react",()=>({useAuthToken:()=>getToken()}));
const fetchFile=vi.fn();
beforeEach(()=>{
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL","https://sample.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL","");
  vi.stubGlobal("fetch",fetchFile);
  getToken.mockReset().mockReturnValue("test-session-token");
  fetchFile.mockReset().mockResolvedValue({ok:true,blob:async()=>new Blob(["photo"],{type:"image/png"})});
  Object.defineProperty(URL,"createObjectURL",{configurable:true,value:vi.fn(()=>"blob:private-photo")});
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("private stored attachments",()=>{
  it("fetches only on request, authenticates delivery, and revokes the local preview",async()=>{
    const {unmount}=render(<PrivateAttachment media={{_id:"media-one" as Id<"media">,kind:"photo",state:"ready"}}/>);
    expect(fetchFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"View photo privately"}));
    await waitFor(()=>expect(screen.getByAltText("Your private repair attachment")).toBeInTheDocument());
    expect(fetchFile.mock.calls[0][0].toString()).toBe("https://sample.convex.site/media?id=media-one");
    expect(fetchFile.mock.calls[0][1].headers.Authorization).toBe("Bearer test-session-token");
    expect(fetchFile.mock.calls[0][1].cache).toBe("no-store");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-photo");
  });
  it("does not fetch a file without a valid session",async()=>{
    getToken.mockReturnValue(null);
    render(<PrivateAttachment media={{_id:"media-one" as Id<"media">,kind:"photo",state:"ready"}}/>);
    fireEvent.click(screen.getByRole("button",{name:"View photo privately"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("session expired");
    expect(fetchFile).not.toHaveBeenCalled();
  });
});
