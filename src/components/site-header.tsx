import Link from "next/link";
import { Suspense } from "react";
import { siteConfig } from "@/config/site";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/** Public header. The account button reads the session, so it streams in. */
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">
          {siteConfig.name}
        </Link>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/pricing">Pricing</Link>
          </Button>
          <Suspense fallback={<SignInButton />}>
            <AccountButton />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}

function SignInButton() {
  return (
    <Button asChild>
      <Link href="/login">Sign in</Link>
    </Button>
  );
}

async function AccountButton() {
  const user = await getCurrentUser();
  if (!user) return <SignInButton />;
  return (
    <Button asChild>
      <Link href="/dashboard">Dashboard</Link>
    </Button>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <span>
          {siteConfig.name} · <a href={`mailto:${siteConfig.supportEmail}`}>{siteConfig.supportEmail}</a>
        </span>
        <span className="flex gap-4">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </span>
      </div>
    </footer>
  );
}
