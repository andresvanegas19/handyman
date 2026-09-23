import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { STARTER_GUIDES } from "@/lib/catalog";
import HomePopular from "./home-popular";
import CatalogBrowser from "./catalog-browser";

const { query, config } = vi.hoisted(() => ({ query: vi.fn(), config: { hasConvex: true } }));
vi.mock("convex/react", () => ({ useQuery: query }));
vi.mock("@/lib/config", () => config);

beforeEach(() => {
  config.hasConvex = true;
  query.mockReset().mockReturnValue([]);
});
afterEach(cleanup);

describe("examples alongside the connected catalog", () => {
  it.each([undefined, []])("keeps home examples visible when published guides are %j", (guides) => {
    query.mockReturnValue(guides);
    render(<HomePopular/>);
    const examples = screen.getByRole("region", { name: "Explore draft examples" });
    expect(within(examples).getAllByRole("link")).toHaveLength(4);
    expect(within(examples).getByText(/not approved repair instructions/)).toBeInTheDocument();
    for (const guide of STARTER_GUIDES.slice(0, 3)) {
      expect(within(examples).getByRole("link", { name: new RegExp(guide.title) })).toHaveAttribute("href", `/examples/${guide.slug}`);
    }
  });

  it("keeps published guides separate from examples", () => {
    query.mockReturnValue([{ ...STARTER_GUIDES[0], status: "published" }]);
    render(<HomePopular/>);
    const links = screen.getAllByRole("link", { name: new RegExp(STARTER_GUIDES[0].title) });
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      `/catalog/${STARTER_GUIDES[0].slug}`,
      `/examples/${STARTER_GUIDES[0].slug}`,
    ]);
  });

  it("shows examples without querying an unconfigured backend", () => {
    config.hasConvex = false;
    render(<HomePopular/>);
    expect(screen.getByRole("region", { name: "Explore draft examples" })).toBeInTheDocument();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([undefined, []])("lists all catalog examples when published guides are %j", (guides) => {
    query.mockReturnValue(guides);
    render(<CatalogBrowser/>);
    const examples = screen.getByRole("region", { name: "Explore draft examples" });
    expect(examples).toHaveAttribute("id", "examples");
    expect(within(examples).getAllByRole("link")).toHaveLength(STARTER_GUIDES.length);
  });
});
