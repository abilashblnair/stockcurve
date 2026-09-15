"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletButton from "./WalletButton";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" stroke="currentColor" strokeWidth="2" />
      <path d="M5 18c4 0 6-1.5 8-5s3.5-7 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="19" cy="6" r="1.8" fill="currentColor" />
    </svg>
  );
}

const LINKS: { href: string; label: string; extra?: boolean }[] = [
  { href: "/create", label: "Launch" },
  { href: "/pools", label: "Pools" },
  { href: "/how-it-works", label: "How it works", extra: true },
];

export default function TopBar() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <Link href="/" className="brand">
          <Logo />
          <span>Stockcurve</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={l.extra ? "nav-extra" : undefined} aria-current={path?.startsWith(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
