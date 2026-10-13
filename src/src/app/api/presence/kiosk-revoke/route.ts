import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const deviceId = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("aero_presence_kiosk_device_id="))?.split("=").slice(1).join("=") || "";
  if (!accessToken) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (!deviceId) return NextResponse.json({ error: "KIOSK_NOT_REGISTERED" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { error } = await supabase.rpc("revoke_presence_kiosk", { p_device_id: deviceId });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  const response = NextResponse.json({ ok: true, activated: false });
  response.cookies.set("aero_presence_kiosk_token", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/api/presence", maxAge: 0 });
  response.cookies.set("aero_presence_kiosk_device_id", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/api/presence", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
