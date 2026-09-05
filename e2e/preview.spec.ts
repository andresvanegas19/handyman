import { expect, test } from "@playwright/test";
import { STARTER_GUIDES } from "../src/lib/catalog";

test("how it works links to all examples and the home example opens as a draft", async ({ page }) => {
  await page.goto("/#how-it-works");
  await page.getByRole("link", { name: "Explore the examples", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog#examples$/);
  await expect(page.locator("#examples .guide-card")).toHaveCount(STARTER_GUIDES.length);
  await page.goto("/");
  await page.locator('#examples a[href="/examples/squeaky-door-hinge"]').click();
  await expect(page).toHaveURL(/\/examples\/squeaky-door-hinge$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STARTER_GUIDES[0].title);
  await expect(page.getByText("For exploration, not repair instructions.")).toBeVisible();
});

test("home has a usable catalog journey without credentials", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /explore fixes/i }).first()).toBeVisible();
  await page.getByRole("link", { name: /explore fixes/i }).first().click();
  await expect(page).toHaveURL(/\/catalog/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("catalog search filters drafts and can recover from no matches", async ({ page }) => {
  await page.goto("/catalog");
  const search = page.getByRole("searchbox");
  const cards = page.getByRole("link").and(page.locator('a[href^="/catalog/"]'));
  await expect(search).toBeVisible();
  await search.fill("aerator");
  await expect(cards.and(page.locator('[href="/catalog/slow-faucet-aerator"]'))).toBeVisible();
  await expect(cards).toHaveCount(1);
  await search.fill("no-such-household-problem");
  await expect(cards).toHaveCount(0);
  await search.fill("");
  await expect(cards).toHaveCount(STARTER_GUIDES.length);
});

test("guide previews are labeled and expose useful content", async ({ page }) => {
  const guide = STARTER_GUIDES.find((candidate) => candidate.assemblyKind === "hinge");
  if (!guide) throw new Error("The starter catalog must include a hinge assembly.");
  await page.goto(`/catalog/${guide.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: guide.title })).toBeVisible();
  await expect(page.getByText(/draft|preview/i).first()).toBeVisible();
  await expect(page.getByText(/not a Tripo model|illustrative/i).first()).toBeVisible();
});

test("parts can be selected, isolated, exploded, and reset", async ({ page }) => {
  await page.goto("/catalog/squeaky-door-hinge");
  await page.getByRole("button", { name: "Hinge close-up", exact: true }).click();
  await page.getByRole("button", { name: "Explode view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assemble view", exact: true })).toHaveAttribute("aria-pressed", "true");
  const part = page.getByRole("button", { name: /^(01 )?Frame leaf/ });
  await part.click();
  await expect(part).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Isolate part", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show all parts", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset assembly view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explode view", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Isolate part", exact: true })).toBeDisabled();
});

test("preview photos stay local and can be removed", async ({ page }) => {
  const outgoing: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") outgoing.push(request.url());
  });
  await page.goto("/problems/new");
  await page.locator("#photos").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const photo = page.getByRole("img", { name: "Your selected photo 1" });
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("button", { name: "Save temporary repair" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await expect(photo).toHaveCount(0);
  expect(outgoing).toEqual([]);
});

for (const route of ["/", "/catalog", "/problems/new", "/problems", "/admin"]) {
  test(`${route} is responsive and does not crash without service keys`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(sign in|log in|register|create account)/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^(sign in|log in|register|create account)/i })).toHaveCount(0);
    const fitsViewport = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(fitsViewport).toBe(true);
    expect(errors).toEqual([]);
  });
}
