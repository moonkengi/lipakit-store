"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  /** Shown greyed out and not clickable, e.g. for a section you haven't built yet. */
  disabled?: boolean;
};

export function NavLinks({ items }: { items: NavItem[] }) {
  return <NavList items={items} pathname={usePathname()} />;
}

/** Same links without the active highlight: the Suspense fallback while the pathname is unknown. */
export function NavLinksFallback({ items }: { items: NavItem[] }) {
  return <NavList items={items} pathname={null} />;
}

function NavList({ items, pathname }: { items: NavItem[]; pathname: string | null }) {
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
      {items.map((item) => {
        // Exact match for section roots (/dashboard, /admin), prefix match for children.
        const active =
          pathname !== null &&
          (pathname === item.href || (item.href.split("/").length > 2 && pathname.startsWith(item.href)));
        if (item.disabled) {
          return (
            <span key={item.href} className="cursor-not-allowed rounded-md px-3 py-2 text-sm text-muted-foreground/60">
              {item.label}
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors hover:bg-accent",
              active && "bg-accent font-medium",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
