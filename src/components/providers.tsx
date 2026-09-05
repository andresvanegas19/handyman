"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { hasClerk } from "@/lib/config";

const convex = process.env.NEXT_PUBLIC_CONVEX_URL
  ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL)
  : null;

export default function Providers({ children }: { children: React.ReactNode }) {
  const content = convex
    ? hasClerk
      ? <ConvexProviderWithClerk client={convex} useAuth={useAuth}>{children}</ConvexProviderWithClerk>
      : <ConvexProvider client={convex}>{children}</ConvexProvider>
    : children;
  return hasClerk ? <ClerkProvider>{content}</ClerkProvider> : content;
}
