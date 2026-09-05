import { expect, test } from "@playwright/test";
import { TEMPORARY_STORAGE_KEY } from "../src/lib/temporary-storage";

test("a repair can be saved, reopened after refresh, and deleted without a backend", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto("/problems/new");
  await page.getByRole("textbox", { name: /What's happening/ }).fill("My drawer sticks when opening");
  await page.locator("#photos").setInputFiles({
    name: "drawer.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save temporary repair" }).click();
  await expect(page).toHaveURL(/\/problems\/[0-9a-f-]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Your temporary repair." })).toBeVisible();
  await expect(page.getByRole("img", { name: "Temporary repair photo: drawer.png" })).toBeVisible();
  await page.getByRole("textbox", { name: "Your notes" }).fill("Only the top drawer catches.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved in this tab.");
  await page.getByRole("combobox", { name: "Choose a catalog example to explore" }).selectOption("sticky-drawer");
  await page.getByRole("button", { name: "Open selected example" }).click();
  await expect(page).toHaveURL(/\/catalog\/sticky-drawer$/);
  await page.goBack();
  await expect(page.getByRole("img", { name: "Temporary repair photo: drawer.png" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("My drawer sticks when opening");
  await expect(page.getByRole("textbox", { name: "Your notes" })).toHaveValue("Only the top drawer catches.");
  await expect(page.getByRole("combobox", { name: "Choose a catalog example to explore" })).toHaveValue("sticky-drawer");
  await expect(page.getByText(/This attachment cleared on refresh/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Temporary repair photo: drawer.png" })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete temporary repair", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await expect(page.getByText("A fresh start for your small fixes.")).toBeVisible();
  expect(posts).toEqual([]);
});

test("guide feedback persists in this tab and updates without duplicates", async ({ page }) => {
  await page.goto("/catalog/squeaky-door-hinge");
  await page.getByRole("button", { name: "Worked", exact: true }).click();
  await page.getByRole("textbox", { name: "Your feedback notes" }).fill("Useful illustration.");
  await page.getByRole("button", { name: "Save outcome", exact: true }).click();
  await expect(page.getByText(/Outcome saved in this tab/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Worked", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Your feedback notes" })).toHaveValue("Useful illustration.");
  await page.getByRole("button", { name: "Partly worked", exact: true }).click();
  await page.getByRole("button", { name: "Save outcome", exact: true }).click();
  const state = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null"), TEMPORARY_STORAGE_KEY);
  expect(state.ratings).toHaveLength(1);
  expect(state.ratings[0].outcome).toBe("partly");
  await page.goto("/problems");
  await page.getByRole("button", { name: "Clear this tab's saved data" }).click();
  expect(await page.evaluate(key => sessionStorage.getItem(key), TEMPORARY_STORAGE_KEY)).not.toBeNull();
  await page.getByRole("button", { name: "Confirm clear", exact: true }).click();
  expect(await page.evaluate(key => sessionStorage.getItem(key), TEMPORARY_STORAGE_KEY)).toBeNull();
  await page.goto("/catalog/squeaky-door-hinge");
  await expect(page.getByRole("button", { name: "Partly worked", exact: true })).toHaveAttribute("aria-pressed", "false");
});
