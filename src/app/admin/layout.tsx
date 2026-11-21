import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

// Sections marked disabled are built in Milestone 4.
const nav: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users & subscriptions", disabled: true },
  { href: "/admin/orders", label: "Orders & transactions", disabled: true },
  { href: "/admin/unmatched", label: "Unmatched C2B", disabled: true },
  { href: "/admin/review", label: "Needs review", disabled: true },
  { href: "/admin/callbacks", label: "Callback log", disabled: true },
  { href: "/admin/c2b", label: "Register C2B URLs", disabled: true },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <AppShell area="Admin" nav={nav}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AdminOnly>{children}</AdminOnly>
      </Suspense>
    </AppShell>
  );
}

/**
 * Gate for every page under /admin: non-admins get a 404. Pages should still
 * call requireAdmin() before using the service-role client.
 */
async function AdminOnly({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}
