import type { Metadata } from "next";
import Providers from "@/components/providers";
import { Footer, Header } from "@/components/site-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Handyman — A little help. A better home.", template: "%s | Handyman" },
  description: "Make sense of small home repairs with clear, cautious guidance and interactive parts. Start with a description, photo, or voice note.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers><a href="#main" className="skip-link">Skip to content</a><Header/><main id="main">{children}</main><Footer/></Providers></body></html>;
}
