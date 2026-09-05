import { expect, test } from "@playwright/test";
import { inspectMedia } from "../convex/mediaValidation";

test("actual browser voice recordings pass backend media validation", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  await page.goto("/problems/new");
  const recorded = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks: Blob[] = [];
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Synthetic microphone recording failed."));
    });
    try {
      recorder.start(250);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      recorder.stop();
      await stopped;
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  });
  const result = inspectMedia(new Uint8Array(recorded), "audio");
  expect(result.mime).toBe("audio/webm");
  expect(result.durationSeconds).toBeGreaterThan(1);
  expect(result.durationSeconds).toBeLessThan(5);
});

test("voice-note controls prepare and save valid WAV without uploading", async ({ page, context }) => {
  const posts: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await context.grantPermissions(["microphone"]);
  await page.goto("/problems/new");
  await page.getByRole("button", { name: "Record a voice note" }).click();
  const stop = page.getByRole("button", { name: /^Stop/ });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1500);
  await stop.click();
  await expect(page.getByText(/Audio stays in memory on this device/)).toBeVisible();
  const audio = page.locator("audio");
  await expect(audio).toHaveAttribute("src", /^blob:/);
  const bytes = await audio.evaluate(async (element) => {
    if (!(element instanceof HTMLAudioElement)) throw new Error("Expected an audio preview.");
    const response = await fetch(element.src);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  });
  const prepared = inspectMedia(new Uint8Array(bytes), "audio");
  expect(prepared.mime).toBe("audio/wav");
  expect(prepared.durationSeconds).toBeGreaterThan(1);
  expect(prepared.durationSeconds).toBeLessThan(5);
  await expect(page.getByRole("button", { name: "Save temporary repair" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove audio" }).click();
  await expect(audio).toHaveCount(0);
  await page.locator("#audio").setInputFiles({ name: "recording.wav", mimeType: "audio/wav", buffer: Buffer.from(bytes) });
  await expect(page.getByText(/Audio stays in memory on this device/)).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save temporary repair" }).click();
  await expect(page).toHaveURL(/\/problems\/[0-9a-f-]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Your temporary repair." })).toBeVisible();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  expect(posts).toEqual([]);
});
