"use client";
import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { LockKeyhole } from "lucide-react";
import { isConnected } from "@/lib/config";
import { GuestSessionStatus } from "./guest-session";

export default function AuthGate({ children, label = "Your repairs, all in one place." }: { children: React.ReactNode; label?: string }) {
  if (!isConnected) return <div className="empty-state"><LockKeyhole size={38}/><h2>{label}</h2><p>These backend tools need a connected Convex deployment. No account is needed to save temporary repairs or rate examples in this tab.</p><Link className="button" href="/problems">Open My repairs</Link></div>;
  return <ConnectedGate>{children}</ConnectedGate>;
}
function ConnectedGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) return <GuestSessionStatus/>;
  return children;
}
