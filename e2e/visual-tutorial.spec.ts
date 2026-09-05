import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] } });

test("3D rendering survives focusing, resetting, and separating the door", async ({ page }) => {
  await page.goto("/catalog/squeaky-door-hinge");
  const model = page.getByRole("complementary", { name: "Interactive visual reference" });
  await model.getByRole("button", { name: "Handle", exact: true }).click();
  await expect(model.getByRole("button", { name: "Focus part", exact: true })).toBeEnabled({ timeout: 20_000 });
  await model.getByRole("button", { name: "Focus part", exact: true }).click();
  await model.getByRole("button", { name: "Reset assembly view", exact: true }).click();
  await model.getByRole("button", { name: "Explode view", exact: true }).click();
  await model.getByRole("button", { name: "Handle", exact: true }).click();
  await expect(model.getByRole("button", { name: "Focus part", exact: true })).toBeEnabled();
  await model.getByRole("button", { name: "Isolate part", exact: true }).click();
  await expect(model.locator("canvas")).toBeVisible();
  await expect(model.getByRole("alert")).toHaveCount(0);
});

test("the squeaky hinge page starts with a whole door and opens decomposable hinge details", async ({ page }) => {
  await page.goto("/catalog/squeaky-door-hinge");
  await expect(page.getByRole("button", { name: "Whole door", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Explode view", exact: true }).click();
  await page.getByRole("button", { name: /^(03 )?Hinges In this step$/ }).click();
  await page.getByRole("button", { name: "Inspect hinge parts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hinge close-up", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^(01 )?Frame leaf In this step$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(03 )?Hinge pin$/ })).toBeVisible();
});

test("the homepage door can be decomposed and each visible component inspected", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Take it apart. On screen." })).toBeVisible();
  await expect(page.getByRole("main").getByText("4 labeled parts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explode view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assemble view", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const label of ["Door frame", "Door panel", "Hinges", "Handle"]) {
    const part = page.getByRole("button", { name: new RegExp(`^(0[1-4] )?${label}$`) });
    await part.click();
    await expect(part).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Isolate part", exact: true }).click();
    await expect(page.getByText(`${label} selected · isolated.`)).toBeVisible();
    await page.getByRole("button", { name: "Show all parts", exact: true }).click();
  }
  await page.getByRole("button", { name: "Reset assembly view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explode view", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test("visual checkpoints highlight parts and pause safely on a mismatch", async ({ page }) => {
  await page.goto("/catalog/worn-weatherstrip");
  const checkpoint = page.getByRole("article", { name: "Visual checkpoint 1" });
  await expect(checkpoint).toBeVisible();
  await expect(page.getByRole("button", { name: "Next checkpoint", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /^0?4? ?Handle$/ }).click();
  await page.getByRole("button", { name: "Show step 4: Preserve normal operation" }).click();
  await expect(page.getByRole("article", { name: "Visual checkpoint 4" })).toContainText("Hinges, Handle");
  await page.getByRole("button", { name: /My object looks different/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pause the physical repair." })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /I understand this visual checkpoint/ })).toBeDisabled();
  await page.getByRole("button", { name: "Restart reference-only exploration" }).click();
  await page.getByRole("checkbox", { name: /I understand this visual checkpoint/ }).check();
  await page.getByRole("button", { name: "Next checkpoint", exact: true }).click();
  await expect(page.getByRole("article", { name: "Visual checkpoint 2" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /I understand this visual checkpoint/ })).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
