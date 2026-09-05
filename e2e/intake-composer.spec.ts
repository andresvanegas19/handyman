import { expect, test } from "@playwright/test";

test("light composer is responsive and exposes attachment options", async ({ page }) => {
  await page.goto("/problems/new");
  await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  const input = page.getByRole("textbox", { name: "What's happening?" });
  await expect(input).toHaveAttribute("placeholder", "Ask about a repair");
  const screen = page.locator("#main > div");
  await expect(screen).toHaveCSS("color-scheme", "light");
  expect(await screen.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(251, 250, 246)");
  const toggle = page.getByRole("button", { name: "Add attachments" });
  await toggle.click();
  await expect(page.getByRole("button", { name: /Upload audio/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Add a photo of the problem" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Describe what needs fixing" })).toHaveCount(0);
  await input.click();
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("composer keeps consent explicit and supports multiline text and keyboard submission", async ({ page }) => {
  await page.goto("/problems/new");
  const input = page.getByRole("textbox", { name: "What's happening?" });
  await input.fill("The cabinet handle is loose.");
  const submit = page.getByRole("button", { name: "Save temporary repair" });
  await expect(submit).toBeDisabled();
  await input.press("Enter");
  await expect(page).toHaveURL(/\/problems\/new$/);
  await page.getByRole("checkbox").check();
  await input.press("End");
  await input.press("Shift+Enter");
  await input.pressSequentially("It started yesterday.");
  await expect(input).toHaveValue("The cabinet handle is loose.\nIt started yesterday.");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/problems\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Your temporary repair." })).toBeVisible();
});
