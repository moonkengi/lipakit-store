import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { telegramConfigured } from "@/lib/telegram";
import { PushToggle } from "@/components/push-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TelegramLink } from "./telegram-link";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  await connection();
  const user = await requireUser("/dashboard/settings");
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Notifications in this browser</CardTitle>
          <CardDescription>Get payment confirmations and renewal reminders as browser notifications.</CardDescription>
        </CardHeader>
        <CardContent>
          <PushToggle />
        </CardContent>
      </Card>
      {telegramConfigured() && (
        <Card>
          <CardHeader>
            <CardTitle>Telegram</CardTitle>
            <CardDescription>Receive the same messages in Telegram.</CardDescription>
          </CardHeader>
          <CardContent>
            <TelegramLink linked={user.telegramLinked} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
