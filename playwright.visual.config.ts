import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/visual-repair",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "small-phone", use: { ...devices["iPhone SE"], defaultBrowserType: "chromium", viewport: { width: 320, height: 568 } } },
  ],
  webServer: {
    command: "npx vite --config e2e/visual-repair/vite.config.ts --host 127.0.0.1 --port 3101 --strictPort",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
