import type { Metadata } from "next";
import Providers from "@/components/providers";
import { Footer, Header } from "@/components/site-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Handyman — A little help. A better home.", template: "%s | Handyman" },
  description: "Explore small home repairs with clear guidance and interactive parts. The connected visual workflow starts with a photo and written description.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers><a href="#main" className="skip-link">Skip to content</a><Header/><main id="main">{children}</main><Footer/></Providers></body></html>;
}
