"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/cou", label: "Customer app" },
  { href: "/oem", label: "OEM" },
  { href: "/biller", label: "Biller" },
  { href: "/nbbl", label: "NBBL" },
  { href: "/admin/db", label: "Database" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-sm font-bold text-white">
            B
          </span>
          Bharat BaaS
        </Link>
        <nav aria-label="Party switcher" className="flex flex-wrap gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  active ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
