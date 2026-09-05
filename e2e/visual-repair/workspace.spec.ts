import { expect, test } from "@playwright/test";
import { fixtureGlb } from "./model.fixture";
import type {} from "./store.fixture";

test("progress becomes a mapped 3D guide without hiding navigation", async ({ page }) => {
  let downloads = 0;
  await page.route("**/repair-scene?*", async route => {
    downloads++;
    expect(route.request().headers().authorization).toBe("Bearer local-browser-fixture-token");
    await route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(fixtureGlb()) });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inspect the cabinet handle" })).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText(/research|search/i);
  await page.evaluate(() => window.visualFixture.ready());
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Inspect the cabinet handle" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Locate the highlighted visible handle");
  await page.getByRole("button", { name: /next/i }).click();
  await expect(page.getByRole("main")).toContainText("Locate the highlighted visible panel");
  await page.getByRole("button", { name: /previous/i }).click();
  await expect(page.getByRole("main")).toContainText("Locate the highlighted visible handle");
  expect(downloads).toBe(1);
  await expect(page.getByRole("link", { name: "Handyman home" })).toBeVisible();
  if (test.info().project.name === "small-phone") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "My repairs", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close navigation" }).click();
  } else {
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("unavailable private geometry never exposes a text-only solution", async ({ page }) => {
  await page.route("**/repair-scene?*", route => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.ready());
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /next/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Handyman home" })).toBeVisible();
});

test("failed processing is retryable instead of remaining a spinner", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.phase("failed", "Model preparation failed."));
  await expect(page.getByRole("main")).toContainText("Model preparation failed.");
  await page.getByRole("button", { name: /retry/i }).click();
  await expect(page.getByRole("main")).toContainText(/recogniz|identify/i);
  expect(await page.evaluate(() => window.visualFixture.calls().filter(call => call.name === "repairPipeline:retry").length)).toBe(1);
  await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
});

test("expiring the owner session removes the loaded guide", async ({ page }) => {
  await page.route("**/repair-scene?*", route => route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(fixtureGlb()) }));
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.ready());
  await expect(page.getByRole("heading", { name: "Inspect the cabinet handle" })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.visualFixture.expireSession());
  await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText(/session|sign|connect|refresh/i);
});
