import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const deviceToken = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("aero_presence_kiosk_token="))?.split("=").slice(1).join("=") || "";
  if (!accessToken) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (!deviceToken) return NextResponse.json({ error: "KIOSK_NOT_REGISTERED" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  let body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown } = {};
  try { body = await request.json(); } catch { /* GPS is optional for the registered kiosk. */ }

  const validGps = typeof body.latitude === "number" && typeof body.longitude === "number" && typeof body.accuracy === "number";
  const args: Record<string, unknown> = { p_device_token: deviceToken };
  if (validGps) {
    args.p_lat = body.latitude;
    args.p_lng = body.longitude;
    args.p_accuracy_m = body.accuracy;
  }

  const { data, error } = await supabase.rpc("kiosk_daily_checkin", args);
  if (error) return NextResponse.json({ error: error.message }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
