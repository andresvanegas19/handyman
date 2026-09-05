import { Info, ShieldCheck } from "lucide-react";
import { hasConvex, isConnected } from "@/lib/config";
export function PreviewNotice() {
  if (hasConvex) return null;
  return <div className="notice"><Info size={19}/><div><strong>Preview — draft content</strong><p>These six examples let you explore Handyman. They have not been approved for repair use. No AI service is configured, and nothing you enter is uploaded.</p></div></div>;
}
export function SetupNotice() {
  if (isConnected) return null;
  return <div className="notice"><ShieldCheck size={19}/><div><strong>Temporary MVP — no account needed.</strong><p>Save repair text and ratings in this tab. Photos and audio stay in memory and clear on refresh. Closing the tab normally clears its saved data. No AI service is configured, and nothing is uploaded.</p></div></div>;
}
