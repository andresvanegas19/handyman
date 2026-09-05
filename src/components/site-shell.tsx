"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, House, Menu, X, Wrench } from "lucide-react";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { hasClerk } from "@/lib/config";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Handyman home"><span className="brand-mark"><House size={25}/><Wrench size={12}/></span>Handyman<span className="brand-dot">.</span></Link>;
}

export function Header() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return <header className="site-header"><div className="container header-inner">
    <Brand/>
    <nav className={open ? "main-nav is-open" : "main-nav"} aria-label="Main navigation">
      <Link onClick={() => setOpen(false)} href="/#how-it-works">How it works</Link>
      <Link onClick={() => setOpen(false)} href="/catalog" aria-current={path.startsWith("/catalog") ? "page" : undefined}>Explore fixes</Link>
      <Link onClick={() => setOpen(false)} href="/problems" aria-current={path === "/problems" ? "page" : undefined}>My repairs</Link>
    </nav>
    <div className="header-actions">{hasClerk && <><SignedIn><UserButton/></SignedIn><SignedOut><SignInButton mode="modal"><button className="sign-in">Sign in</button></SignInButton></SignedOut></>}
      <Link href="/problems/new" className="button button-small header-cta">Describe a problem <ArrowUpRight size={16}/></Link>
      <button className="menu-button icon-button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button>
    </div>
  </div></header>;
}

export function Footer() {
  return <footer className="site-footer"><div className="container footer-top"><div><Brand/><p>A little know-how goes a long way.</p></div><div className="footer-links"><Link href="/catalog">Explore fixes</Link><Link href="/problems/new">Get a little help</Link><Link href="/privacy">Privacy & safety</Link><Link href="/admin">Admin</Link></div></div><div className="container footer-bottom"><span>© {new Date().getFullYear()} Handyman. Made for the place you call home.</span><span>Small fixes. Big difference.</span></div></footer>;
}
