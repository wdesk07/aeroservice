import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data, error } = await supabase.rpc("activate_presence_kiosk", { p_name: "Borne officielle Aéro Service" });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  const result = data as { ok?: boolean; device_token?: string; device_id?: string };
  if (!result?.ok || !result.device_token || !result.device_id) {
    return NextResponse.json({ error: "KIOSK_ACTIVATION_FAILED" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true, activated: true });
  const options = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/api/presence", maxAge: 60 * 60 * 24 * 45 };
  response.cookies.set("aero_presence_kiosk_token", result.device_token, options);
  response.cookies.set("aero_presence_kiosk_device_id", result.device_id, options);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
