import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogGrid } from "./catalog-browser";
import { STARTER_GUIDES } from "@/lib/catalog";

afterEach(cleanup);
describe("catalog browsing",()=>{
  it("finds the smart thermostat example and its supplied photo",()=>{
    render(<CatalogGrid guides={STARTER_GUIDES}/>);
    fireEvent.change(screen.getByRole("searchbox",{name:"Search repairs"}),{target:{value:"smart thermostat"}});
    expect(screen.getAllByRole("heading",{level:3})).toHaveLength(1);
    expect(screen.getByRole("link",{name:/Installing a Smart Thermostat/})).toHaveAttribute("href","/catalog/smart-thermostat-installation");
    expect(screen.getByRole("img",{name:/Round smart-thermostat base/})).toHaveAttribute("src",expect.stringContaining("smart-thermostat-installation.png"));
  });
  it("shows all examples and draft preview disclosure",()=>{
    render(<CatalogGrid guides={STARTER_GUIDES}/>);
    expect(screen.getAllByRole("heading",{level:3})).toHaveLength(STARTER_GUIDES.length);
    expect(screen.getByText("Preview — draft content")).toBeInTheDocument();
    for (const category of ["All fixes","Doors & windows","Furniture","Plumbing"]) {
      expect(screen.queryByRole("button",{name:category})).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/fixes to explore/)).not.toBeInTheDocument();
  });
  it("searches guides and clears a search",()=>{
    render(<CatalogGrid guides={STARTER_GUIDES}/>);
    fireEvent.change(screen.getByRole("searchbox",{name:"Search repairs"}),{target:{value:STARTER_GUIDES[0].title}});
    expect(screen.getAllByRole("heading",{level:3})).toHaveLength(1);
    expect(screen.getByRole("heading",{name:STARTER_GUIDES[0].title})).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox",{name:"Search repairs"}),{target:{value:"impossible search"}});
    expect(screen.queryByRole("heading",{level:3})).not.toBeInTheDocument();
    expect(screen.queryByText("No matching fixes. Yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Clear search"}));
    expect(screen.getAllByRole("heading",{level:3})).toHaveLength(STARTER_GUIDES.length);
  });
  it("finds the washer example by button or 3D and shows the supplied photo",()=>{
    render(<CatalogGrid guides={STARTER_GUIDES}/>);
    for (const value of ["washing-machine", "washer button", "3D"]) {
      fireEvent.change(screen.getByRole("searchbox",{name:"Search repairs"}),{target:{value}});
      expect(screen.getByRole("heading",{name:"A second chance for a washing-machine knob"})).toBeInTheDocument();
      expect(screen.getByRole("img",{name:/Washing-machine timer dial/})).toBeInTheDocument();
    }
  });
  it("omits empty catalog messaging without substituting samples",()=>{
    render(<CatalogGrid guides={[]}/>);
    expect(screen.queryByText(/fixes to explore/)).not.toBeInTheDocument();
    expect(screen.queryByText("No matching fixes. Yet.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Try a different word or category/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Clear filters"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/quieter door/})).not.toBeInTheDocument();
  });
});
