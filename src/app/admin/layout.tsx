import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const nav: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders & payments" },
  { href: "/admin/users", label: "Users & subscriptions" },
  { href: "/admin/unmatched", label: "Unmatched payments" },
  { href: "/admin/review", label: "Needs review" },
  { href: "/admin/callbacks", label: "Callback log" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/integrations", label: "Integrations" },
  { href: "/admin/health", label: "Health" },
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
 * Gate for every page under /admin: non-admins get a 404. Pages and actions
 * still call requireAdmin() themselves before using the service-role client.
 */
async function AdminOnly({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}
