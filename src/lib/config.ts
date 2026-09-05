export const hasConvex = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
export const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
export const isConnected = hasConvex && hasClerk;
