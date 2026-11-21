import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { siteConfig } from "@/config/site";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { NavLinks, NavLinksFallback, type NavItem } from "./nav-links";

/**
 * Shared chrome for the user dashboard and the admin panel: a sidebar of links
 * plus a top bar with the signed-in user. The shell itself is static; only the
 * user menu and the page content read the session.
 */
export function AppShell({ area, nav, children }: { area: string; nav: NavItem[]; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="border-b bg-muted/40 md:w-60 md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2 px-4">
          <Link href="/" aria-label={`${siteConfig.name} home`}>
            <Image
              src="/brand/lipakit-logo.png"
              alt={siteConfig.name}
              width={635}
              height={125}
              className="h-5 w-auto"
            />
          </Link>
          <span className="text-xs text-muted-foreground">{area}</span>
        </div>
        {/* The active link depends on the URL, so it streams in; the plain list renders instantly. */}
        <Suspense fallback={<NavLinksFallback items={nav} />}>
          <NavLinks items={nav} />
        </Suspense>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b px-4">
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <>
      <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
      {user.role === "admin" && (
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin">Admin</Link>
        </Button>
      )}
      <form action="/auth/signout" method="post">
        <Button variant="outline" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </>
  );
}
