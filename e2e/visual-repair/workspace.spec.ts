import { expect, test } from "@playwright/test";
import { fixtureGlb } from "./model.fixture";
import type {} from "./store.fixture";

test("a model-only preview opens real geometry without requiring a repair guide", async ({ page }) => {
  await page.route("**/repair-scene?*", route => route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(fixtureGlb()) }));
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.preview());
  await expect(page.getByRole("heading", { name: "Your 3D visual preview", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("canvas")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("link", { name: "Handyman home" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
  await expect(page.getByText("Record the displayed error", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  const link = page.getByRole("link", { name: "Download 3D model (GLB)" });
  await expect(link).toHaveAttribute("href", /^blob:/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("a referral offers safe guidance without pretending a mapped repair is ready", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.advice("referral"));
  await expect(page.getByText("Record the displayed error", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Safer next steps for this problem");
  await expect(page.getByText("dishwasher", { exact: true })).toBeVisible();
  await expect(page.getByText(/qwen\/qwen3\.8-flash/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Manufacturer support" })).toBeVisible();
  await expect(page.getByText("Which error code was already on the display?", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => window.visualFixture.calls().filter(call => call.name === "repairPipeline:reportViewerFailure"))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.visualFixture.advice("cancelled"));
  await expect(page.getByText("Record the displayed error", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Manufacturer support" })).toHaveCount(0);
  await expect(page.getByText("dishwasher", { exact: true })).toHaveCount(0);
});

test("pending, needs-input, and failed assessments show advisory without mapped steps", async ({ page }) => {
  await page.goto("/");
  for (const phase of ["recognizing", "generating_model", "needs_input", "failed"] as const) {
    await page.evaluate(phase => window.visualFixture.advice(phase), phase);
    await expect(page.getByText("Record the displayed error", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Manufacturer support" })).toBeVisible();
    await expect(page.getByText("Which error code was already on the display?", { exact: true })).toBeVisible();
    await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
  }
});

test("a failed model download preserves advisory, locks mapped steps, and reports diagnostics", async ({ page }) => {
  await page.route("**/repair-scene?*", route => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.advice("ready"));
  await expect(page.getByText("Record the displayed error", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Interactive repair model unavailable");
  await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.visualFixture.calls().filter(call => call.name === "repairPipeline:reportViewerFailure"))).toEqual([{
    name: "repairPipeline:reportViewerFailure",
    args: { problemId: "visual-fixture", sceneId: "scene-fixture", code: "download_failed" },
  }]);
});

test("recommendations do not push a ready 3D model out of the initial viewport", async ({ page }) => {
  await page.route("**/repair-scene?*", route => route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(fixtureGlb()) }));
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.advice("ready"));
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("canvas")).toBeInViewport({ ratio: 1 });
  await expect(page.getByText("Record the displayed error", { exact: true })).toBeVisible();
});

test("progress becomes a mapped 3D guide without hiding navigation", async ({ page }) => {
  let downloads = 0;
  await page.route("**/repair-scene?*", async route => {
    downloads++;
    expect(route.request().headers().authorization).toBe("Bearer local-browser-fixture-token");
    await route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(fixtureGlb()) });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inspect the cabinet handle" })).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Finding documentation and possible next steps");
  await page.evaluate(() => window.visualFixture.ready());
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Inspect the cabinet handle" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Locate the highlighted visible handle");
  const downloadsAfterLoad = downloads;
  await page.getByRole("button", { name: /next/i }).click();
  await expect(page.getByRole("main")).toContainText("Locate the highlighted visible panel");
  await page.getByRole("button", { name: /previous/i }).click();
  await expect(page.getByRole("main")).toContainText("Locate the highlighted visible handle");
  await expect(page.locator("canvas")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("link", { name: "Handyman home" })).toBeInViewport({ ratio: 1 });
  const instructions = page.getByRole("complementary", { name: "Repair instructions" });
  await instructions.evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  await expect(page.locator("canvas")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: /Pause.*object or model/ })).toBeInViewport();
  expect(downloadsAfterLoad).toBeGreaterThan(0);
  expect(downloads).toBe(downloadsAfterLoad);
  await expect(page.getByRole("link", { name: "Handyman home" })).toBeVisible();
  if (test.info().project.name === "small-phone") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "My repairs", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close navigation" }).click();
  } else {
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("visual intake requires a photo and written prompt with one consent", async ({ page }) => {
  await page.goto("/?mode=intake");
  const submit = page.getByRole("button", { name: "Start visual repair" });
  const text = page.getByRole("textbox", { name: "What's happening?" });
  await page.getByRole("checkbox").check();
  await expect(submit).toBeDisabled();
  await text.fill("The visible cabinet handle is loose.");
  await expect(submit).toBeDisabled();
  await page.getByLabel("Choose photos").setInputFiles({
    name: "handle.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
  });
  await text.fill(" ");
  await expect(submit).toBeDisabled();
  await text.fill("The visible cabinet handle is loose.");
  await expect(submit).toBeEnabled();
  await text.press("Enter");
  expect(await page.evaluate(() => window.visualFixture.calls())).toEqual([{
    name: "visual-intake",
    args: { text: "The visible cabinet handle is loose.", photos: 1, consent: true },
  }]);
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Record a voice note" })).toHaveCount(0);
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
  await expect(page.getByRole("main")).toContainText("Examining your photo and problem");
  expect(await page.evaluate(() => window.visualFixture.calls().filter(call => call.name === "repairPipeline:retry").length)).toBe(1);
  await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
});

test("expiring the owner session removes the loaded guide", async ({ page }) => {
  await page.route("**/repair-scene?*", route => route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(fixtureGlb()) }));
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.advice("ready"));
  await expect(page.getByRole("heading", { name: "Inspect the cabinet handle" })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.visualFixture.expireSession());
  await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText(/session|sign|connect|refresh/i);
  await expect(page.getByRole("region", { name: "Repair recommendations" })).toHaveCount(0);
  await expect(page.getByText("dishwasher", { exact: true })).toHaveCount(0);
});

test("an object mismatch stops the saved run rather than offering local resume", async ({ page }) => {
  await page.route("**/repair-scene?*", route => route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(fixtureGlb()) }));
  await page.goto("/");
  await page.evaluate(() => window.visualFixture.advice("ready"));
  await expect(page.getByRole("heading", { name: "Inspect the cabinet handle" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Pause.*object or model/ }).click();
  await expect(page.getByRole("heading", { name: "This repair was stopped" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume viewing" })).toHaveCount(0);
  await expect(page.getByText("Locate the highlighted visible handle without applying force.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Repair recommendations" })).toHaveCount(0);
  expect(await page.evaluate(() => window.visualFixture.calls().filter(call => call.name === "repairPipeline:cancel").length)).toBe(1);
});
