import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { siteConfig } from "@/config/site";
import { safeNextPath } from "@/lib/safe-redirect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const errorMessages: Record<string, string> = {
  auth_failed: "That sign-in link is invalid or has expired. Request a new one.",
  google_failed: "Google sign-in didn't work. Try again or use email.",
  google_disabled: "Google sign-in is turned off.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Link href="/" className="text-sm font-semibold text-muted-foreground">
            {siteConfig.name}
          </Link>
          <CardTitle className="text-xl">Sign in or create an account</CardTitle>
          <CardDescription>New here? Signing in creates your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* searchParams are request data, so the form streams in behind a boundary. */}
          <Suspense fallback={<LoginForm next="/dashboard" />}>
            <LoginFormWithParams searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function LoginFormWithParams({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  return <LoginForm next={next} initialError={errorKey ? errorMessages[errorKey] : undefined} />;
}
