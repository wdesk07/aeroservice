import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const token = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("aero_presence_kiosk_token="))
    ?.split("=")
    .slice(1)
    .join("=") || "";

  if (!token) {
    return NextResponse.json({ activated: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ activated: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data, error }, { data: dayStatusData, error: dayStatusError }] = await Promise.all([
    supabase.rpc("is_presence_kiosk_active", { p_device_token: token }),
    supabase.rpc("get_public_operating_day_status"),
  ]);
  const allowedStatuses = ["open", "closed", "not_opened"];
  const dayStatus = !dayStatusError && typeof dayStatusData === "string" && allowedStatuses.includes(dayStatusData)
    ? dayStatusData
    : "unknown";

  return NextResponse.json(
    { activated: !error && data === true, dayStatus },
    { headers: { "Cache-Control": "no-store" } },
  );
}
