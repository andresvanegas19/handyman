import type { AuthConfig } from "convex/server";

export default {
  providers: [{
    domain: process.env.CLERK_JWT_ISSUER_DOMAIN ?? "https://clerk-not-configured.invalid",
    applicationID: "convex",
  }],
} satisfies AuthConfig;
