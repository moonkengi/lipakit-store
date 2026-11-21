import { connection } from "next/server";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { runHealthChecks, type CheckStatus } from "@/lib/health";
import { PageHeader } from "../ui";

const icon: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗", info: "i" };
const tone: Record<CheckStatus, string> = {
  ok: "text-primary",
  warn: "text-amber-600",
  fail: "text-destructive",
  info: "text-muted-foreground",
};

export default function HealthPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Health"
        description="Start here when payments seem broken. The same checks run from your terminal with pnpm run doctor."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Running checks…</p>}>
        <Checks />
      </Suspense>
    </div>
  );
}

async function Checks() {
  await connection();
  await requireAdmin();
  const checks = await runHealthChecks();
  const groups = [...new Set(checks.map((c) => c.group))];
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="font-semibold">{g}</h2>
          <ul className="divide-y rounded-xl border">
            {checks
              .filter((c) => c.group === g)
              .map((c) => (
                <li key={c.id} className="flex gap-3 px-4 py-3 text-sm">
                  <span className={`w-4 font-bold ${tone[c.status]}`} aria-label={c.status}>
                    {icon[c.status]}
                  </span>
                  <span className="w-56 shrink-0 font-medium">{c.label}</span>
                  <span className="text-muted-foreground">{c.detail}</span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
