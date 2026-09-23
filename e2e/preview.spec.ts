import { expect, test } from "@playwright/test";
import { STARTER_GUIDES } from "../src/lib/catalog";
import { PREVIEW_PARTS } from "../src/components/viewer/parts";

for (const guide of STARTER_GUIDES.filter(candidate => candidate.assemblyKind)) {
  test(`full-width layout adapts to ${guide.slug}`, async ({ page }) => {
    const kind = guide.assemblyKind === "hinge" ? "door" : guide.assemblyKind!;
    const parts = PREVIEW_PARTS[kind];
    for (const route of ["catalog", "examples"]) {
      await page.goto(`/${route}/${guide.slug}`);
      const viewport = page.getByRole("group", { name: "Interactive model viewport" });
      await expect(viewport).toBeVisible();
      const box = await viewport.boundingBox();
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      expect(box!.x).toBeCloseTo(0, 0);
      expect(box!.width).toBeCloseTo(width, 0);
      await expect(page.getByRole("list", { name: "Assembly parts" }).getByRole("listitem")).toHaveCount(parts.length);
      const part = parts[0];
      await page.getByRole("button", { name: `Hide ${part.label}`, exact: true }).click();
      await expect(page.getByRole("button", { name: `Show ${part.label}`, exact: true })).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: `Show ${part.label}`, exact: true }).click();
      await expect(page.getByRole("button", { name: `Hide ${part.label}`, exact: true })).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
}

test("how it works links to all examples and the home example opens as a draft", async ({ page }) => {
  await page.goto("/#how-it-works");
  await page.getByRole("link", { name: "Explore the examples", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog#examples$/);
  await expect(page.locator("#examples .guide-card")).toHaveCount(STARTER_GUIDES.length);
  await page.goto("/");
  await page.locator('#examples a[href="/examples/squeaky-door-hinge"]').click();
  await expect(page).toHaveURL(/\/examples\/squeaky-door-hinge$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STARTER_GUIDES[0].title);
  await expect(page.getByText("For exploration, not repair instructions.")).toHaveCount(0);
  await expect(page.getByText("Version 1 · Draft preview")).toBeVisible();
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

test("catalog model fills the reference with collapsible steps and visibility controls", async ({ page }) => {
  await page.goto("/catalog/squeaky-door-hinge");
  const viewer = page.getByRole("region", { name: "Interactive parts viewer", exact: true });
  const viewport = page.getByRole("group", { name: "Interactive model viewport" });
  const steps = page.getByRole("navigation", { name: "Visual tutorial steps" });
  await expect(viewport).toBeVisible();
  const viewerBox = await viewer.boundingBox();
  const viewportBox = await viewport.boundingBox();
  const stepsBox = await steps.boundingBox();
  expect(viewerBox).not.toBeNull();
  expect(viewportBox).not.toBeNull();
  expect(stepsBox).not.toBeNull();
  expect(viewportBox!.width).toBeGreaterThan(viewerBox!.width - 4);
  expect(viewportBox!.width).toBeGreaterThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth - 2));
  expect(viewportBox!.height).toBeGreaterThanOrEqual(380);
  const doorViews = viewport.getByRole("group", { name: "Door model views" });
  await expect(doorViews).toBeVisible();
  const doorViewsBox = await doorViews.boundingBox();
  expect(doorViewsBox!.y).toBeGreaterThan(viewportBox!.y);
  expect(doorViewsBox!.y + doorViewsBox!.height).toBeLessThan(viewportBox!.y + viewportBox!.height);
  if (page.viewportSize()!.width > 1000) {
    expect(stepsBox!.y).toBeGreaterThan(viewportBox!.y);
    expect(stepsBox!.y + stepsBox!.height).toBeLessThan(viewportBox!.y + viewportBox!.height);
  }
  await page.getByRole("button", { name: /Hide steps/ }).click();
  await expect(steps).toBeHidden();
  await page.getByRole("button", { name: /Show steps/ }).click();
  await expect(steps).toBeVisible();
  await page.getByRole("button", { name: "Hide Handle", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show Handle", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await expect(page.getByRole("list", { name: "Assembly parts" })).toBeHidden();
  await page.getByRole("button", { name: "Show controls", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show Handle", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("washer catalog example connects its photo, parts, and design checkpoints", async ({ page }) => {
  await page.goto("/catalog");
  await page.getByRole("link", { name: /A second chance for a washing-machine knob/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A second chance for a washing-machine knob");
  const photo = page.getByRole("img", { name: /Washing-machine timer dial/ });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "Explode view", exact: true }).click();
  await page.getByRole("button", { name: /^Detached knob \/ replacement concept/ }).click();
  await page.getByRole("button", { name: "Isolate part", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show all parts", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("navigation", { name: "Visual tutorial steps" }).getByRole("button", { name: /4 Review the 3D-print concept/ }).click();
  await expect(page.getByRole("article", { name: "Visual checkpoint 4" })).toContainText("not a printable replacement");
  await expect(page.getByRole("heading", { name: "Your visible reference" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("smart thermostat example connects its reference photo, model, and planning checkpoints", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/catalog");
  await page.getByRole("searchbox", { name: "Search repairs" }).fill("smart thermostat");
  await page.getByRole("link", { name: /Installing a Smart Thermostat/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Installing a Smart Thermostat? Here's What You Need to Know");
  const photo = page.getByRole("img", { name: /Round smart-thermostat base/ });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole("list", { name: "Assembly parts" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("group", { name: "Door model views" })).toHaveCount(0);
  await page.getByRole("button", { name: "Explode view", exact: true }).click();
  await page.getByRole("button", { name: /^Unidentified conductors/ }).click();
  await page.getByRole("button", { name: "Isolate part", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show all parts", exact: true })).toHaveAttribute("aria-pressed", "true");
  if (page.viewportSize()!.width > 1000) {
    await expect(page.getByRole("button", { name: "Focus part", exact: true })).toBeEnabled({ timeout: 15_000 });
    await page.getByRole("button", { name: "Focus part", exact: true }).click();
  }
  await page.getByRole("navigation", { name: "Visual tutorial steps" }).getByRole("button", { name: /4 Review the C-wire/ }).click();
  await expect(page.getByRole("article", { name: "Visual checkpoint 4" })).toContainText("does not prove a usable C-wire");
  await expect(page.getByRole("button", { name: "Next checkpoint", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
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
