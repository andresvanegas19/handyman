"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { GuestSessionProvider } from "./guest-session";
import { TemporaryStoreProvider } from "./temporary-store";

const convex = process.env.NEXT_PUBLIC_CONVEX_URL
  ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL)
  : null;

export default function Providers({ children }: { children: React.ReactNode }) {
  if (!convex) return <TemporaryStoreProvider>{children}</TemporaryStoreProvider>;
  return <ConvexAuthProvider client={convex}>
    <GuestSessionProvider>{children}</GuestSessionProvider>
  </ConvexAuthProvider>;
}
