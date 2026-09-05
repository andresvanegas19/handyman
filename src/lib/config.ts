export const hasConvex = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
export const isConnected = hasConvex;
export const visualRepairEnabled = isConnected && process.env.NEXT_PUBLIC_VISUAL_REPAIR_ENABLED === "true";
