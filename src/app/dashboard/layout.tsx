import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { IdentifyUser } from "@/lib/analytics/client";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";

export const metadata: Metadata = { title: "Dashboard" };

const nav: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <AppShell area="Dashboard" nav={nav}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <SignedIn>{children}</SignedIn>
      </Suspense>
    </AppShell>
  );
}

/** Renders children only for a signed-in user; everyone else goes to /login. */
async function SignedIn({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <IdentifyUser userId={user.id} role={user.role} />
      {children}
    </>
  );
}
