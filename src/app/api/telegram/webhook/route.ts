/**
 * Telegram bot webhook. Telegram sends the secret we gave it in setWebhook()
 * in the X-Telegram-Bot-Api-Secret-Token header; anything without it is ignored.
 * Always answers 200 quickly so Telegram doesn't retry.
 */
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { safeEqual } from "@/lib/security";
import { handleTelegramUpdate } from "@/lib/telegram";

export async function POST(request: Request) {
  const secret = getServerEnv().TELEGRAM_WEBHOOK_SECRET;
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(header, secret)) return new NextResponse(null, { status: 401 });

  try {
    await handleTelegramUpdate(await request.json());
  } catch (error) {
    console.error("[telegram] update failed", error);
  }
  return NextResponse.json({ ok: true });
}
