import { expect, test } from "@playwright/test";
import { STARTER_GUIDES } from "../src/lib/catalog";

test("home has a usable catalog journey without credentials", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("link", { name: /explore fixes/i }).first()).toBeVisible();
  await page.getByRole("link", { name: /explore fixes/i }).first().click();
  await expect(page).toHaveURL(/\/catalog/);
  await expect(page.locator("h1")).toBeVisible();
  expect(errors).toEqual([]);
});

test("catalog search filters drafts and can recover from no matches", async ({ page }) => {
  await page.goto("/catalog");
  const search = page.getByRole("searchbox");
  await expect(search).toBeVisible();
  await search.fill("aerator");
  await expect(page.getByRole("link", { name: /aerator/i }).first()).toBeVisible();
  await search.fill("no-such-household-problem");
  await expect(page.locator('a[href^="/catalog/"]')).toHaveCount(0);
  await search.fill("");
  await expect(page.locator('a[href^="/catalog/"]')).toHaveCount(STARTER_GUIDES.length);
});

test("guide previews are labeled and expose useful content", async ({ page }) => {
  const guide = STARTER_GUIDES.find((candidate) => candidate.assemblyKind === "hinge");
  if (!guide) throw new Error("The starter catalog must include a hinge assembly.");
  await page.goto(`/catalog/${guide.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: guide.title })).toBeVisible();
  await expect(page.getByText(/draft|preview/i).first()).toBeVisible();
  await expect(page.getByText(/not a Tripo model|illustrative/i).first()).toBeVisible();
});

for (const route of ["/", "/catalog", "/problems/new", "/problems", "/admin"]) {
  test(`${route} is responsive and does not crash without service keys`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    const fitsViewport = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(fitsViewport).toBe(true);
    expect(errors).toEqual([]);
  });
}
