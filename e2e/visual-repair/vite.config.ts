import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: local("./"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: local("../../src") },
      { find: "convex/react", replacement: local("./convex.fixture.ts") },
      { find: "@convex-dev/auth/react", replacement: local("./auth.fixture.ts") },
      { find: "next/dynamic", replacement: local("./dynamic.fixture.tsx") },
      { find: "next/link", replacement: local("./link.fixture.tsx") },
      { find: "next/image", replacement: local("./image.fixture.tsx") },
      { find: "next/navigation", replacement: local("./navigation.fixture.ts") },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_CONVEX_URL": JSON.stringify("https://visual-fixture.convex.cloud"),
    "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": JSON.stringify("http://127.0.0.1:3101"),
    "process.env.NEXT_PUBLIC_VISUAL_REPAIR_ENABLED": JSON.stringify("true"),
  },
  server: { fs: { allow: [local("../../")] } },
});
