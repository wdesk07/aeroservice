import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const deviceToken = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("aero_presence_kiosk_token="))
    ?.split("=").slice(1).join("=") || "";

  if (!accessToken) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (!deviceToken) return NextResponse.json({ error: "KIOSK_NOT_REGISTERED" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data, error } = await supabase.rpc("kiosk_personnel_daily_checkin", {
    p_device_token: deviceToken,
  });
  if (error) {
    const raw = String(error.message || "");
    const known = ["AUTH_REQUIRED", "KIOSK_NOT_REGISTERED", "ACTIVE_PERSONNEL_REQUIRED", "PERSONNEL_CHECKIN_CLOSED"];
    const code = known.find((item) => raw.includes(item)) || "SERVICE_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "AUTH_REQUIRED" ? 401 : code === "KIOSK_NOT_REGISTERED" ? 403 : code === "SERVICE_UNAVAILABLE" ? 503 : 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
