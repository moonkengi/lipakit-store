import { connection } from "next/server";
import { Suspense } from "react";
import { configuredAlertChannels } from "@/lib/alerts";
import { requireAdmin } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { telegramConfigured } from "@/lib/telegram";
import { PushToggle } from "@/components/push-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "../action-form";
import { registerC2BAction, sendTestAlertAction, setTelegramWebhookAction } from "../actions";
import { PageHeader } from "../ui";

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect Safaricom and your notification channels. Keys live in your environment variables."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Integrations />
      </Suspense>
    </div>
  );
}

async function Integrations() {
  await connection();
  await requireAdmin();
  const env = getServerEnv();
  const alerts = configuredAlertChannels().map((c) => c.name);
  const all = ["telegram", "slack", "discord", "webhook", "push"];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Paybill / Till payments (C2B)</CardTitle>
          <CardDescription>
            Tell Safaricom where to send payments customers make from the M-Pesa menu. In production you may only be
            able to do this once per shortcode; changing it later can need Safaricom support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={registerC2BAction}>
            <Button type="submit" variant="outline">
              Register C2B URLs
            </Button>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telegram bot</CardTitle>
          <CardDescription>
            {telegramConfigured()
              ? "Point Telegram at this app so users can link their accounts. Run again if your domain changes."
              : "Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_BOT_USERNAME first."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={setTelegramWebhookAction}>
            <Button type="submit" variant="outline" disabled={!env.TELEGRAM_BOT_TOKEN}>
              Set Telegram webhook
            </Button>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin alerts</CardTitle>
          <CardDescription>
            New payments, payments needing review, unmatched payments, failed callbacks and payout results go to every
            channel below that has its keys set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="grid grid-cols-2 gap-1 text-sm">
            {all.map((c) => (
              <li key={c} className={alerts.includes(c) ? "" : "text-muted-foreground"}>
                {alerts.includes(c) ? "✓" : "–"} {c === "push" ? "web push" : c}
              </li>
            ))}
          </ul>
          <ActionForm action={sendTestAlertAction}>
            <Button type="submit" variant="outline">
              Send a test alert
            </Button>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Web push on this device</CardTitle>
          <CardDescription>Admins with push on get every alert as a browser notification.</CardDescription>
        </CardHeader>
        <CardContent>
          <PushToggle />
          {!env.VAPID_PRIVATE_KEY && (
            <p className="text-sm text-muted-foreground">Off: generate keys with npx web-push generate-vapid-keys.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
