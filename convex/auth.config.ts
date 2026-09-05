import type { AuthConfig } from "convex/server";

export default {
  providers: [{
    domain: process.env.CONVEX_SITE_URL ?? "https://guest-session-not-configured.invalid",
    applicationID: "convex",
  }],
} satisfies AuthConfig;
