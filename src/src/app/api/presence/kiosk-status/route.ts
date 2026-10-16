import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const token = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("aero_presence_kiosk_token="))
    ?.split("=")
    .slice(1)
    .join("=") || "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ activated: false, dayStatus: "unknown" }, { headers: { "Cache-Control": "no-store" } });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: dayStatusData, error: dayStatusError } = await supabase.rpc("get_public_operating_day_status");
  const allowedStatuses = ["open", "closed", "not_opened"];
  const dayStatus = !dayStatusError && typeof dayStatusData === "string" && allowedStatuses.includes(dayStatusData)
    ? dayStatusData
    : "unknown";

  if (!token) {
    return NextResponse.json({ activated: false, dayStatus }, { headers: { "Cache-Control": "no-store" } });
  }

  const [{ data: registered, error: registeredError }, { data: activeNow, error: activeError }] = await Promise.all([
    supabase.rpc("is_presence_kiosk_registered", { p_device_token: token }),
    supabase.rpc("is_presence_kiosk_active", { p_device_token: token }),
  ]);
  return NextResponse.json(
    { activated: !registeredError && registered === true, registered: !registeredError && registered === true, activeNow: !activeError && activeNow === true, dayStatus },
    { headers: { "Cache-Control": "no-store" } },
  );
}
