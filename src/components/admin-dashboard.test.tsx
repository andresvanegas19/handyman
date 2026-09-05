import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScheduledFailures } from "./admin-dashboard";

const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("convex/react",()=>({useQuery:query,useMutation:vi.fn(),useAction:vi.fn()}));
vi.mock("next/dynamic",()=>({default:()=>()=>null}));
afterEach(cleanup);
describe("admin scheduled operation alerts",()=>{
  it("surfaces backend cleanup failures without claiming completion",()=>{
    query.mockReturnValue([{_id:"scheduled-one",functionName:"cleanup:removeFile",scheduledTime:1000,message:"Cleanup failed. Review the deployment logs."}]);
    render(<ScheduledFailures/>);
    expect(screen.getByRole("alert")).toHaveTextContent("cleanup:removeFile");
    expect(screen.getByRole("alert")).toHaveTextContent("Cleanup failed");
    expect(screen.getByText(/Do not assume/)).toBeInTheDocument();
  });
  it("distinguishes loading from an empty failure list",()=>{
    query.mockReturnValue(undefined);
    const {rerender}=render(<ScheduledFailures/>);
    expect(screen.getByRole("status")).toHaveTextContent("Checking scheduled operations");
    query.mockReturnValue([]);
    rerender(<ScheduledFailures/>);
    expect(screen.getByText("No failed scheduled operations reported.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
