/**
 * Small building blocks shared by admin pages: headers, tables, badges, and a
 * GET filter form (filters live in the URL, so admin views can be bookmarked).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dateTime = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Nairobi",
});

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  if (empty) return <p className="rounded-xl border p-6 text-sm text-muted-foreground">Nothing here.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, mono, className }: { children: ReactNode; mono?: boolean; className?: string }) {
  return <td className={`px-3 py-2 align-top ${mono ? "font-mono text-xs" : ""} ${className ?? ""}`}>{children}</td>;
}

const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  success: "default",
  active: "default",
  trialing: "secondary",
  pending: "secondary",
  grace: "destructive",
  needs_review: "destructive",
  unmatched: "destructive",
  failed: "destructive",
  timeout: "destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={tone[status] ?? "outline"} className="capitalize">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

/** GET form for filters. `fields` are rendered as selects or a search box. */
export function Filters({
  action,
  values,
  selects = [],
  search,
}: {
  action: string;
  values: Record<string, string | undefined>;
  selects?: { name: string; label: string; options: string[] }[];
  search?: string;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {selects.map((s) => (
        <label key={s.name} className="text-xs text-muted-foreground">
          {s.label}
          <select
            name={s.name}
            defaultValue={values[s.name] ?? ""}
            className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"
          >
            <option value="">All</option>
            {s.options.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      ))}
      {search && <Input name="q" placeholder={search} defaultValue={values.q ?? ""} className="w-64" />}
      <Button type="submit" variant="outline">
        Apply
      </Button>
      <Button asChild variant="ghost">
        <Link href={action}>Reset</Link>
      </Button>
    </form>
  );
}

export function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
