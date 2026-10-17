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
  const { data, error } = await supabase.rpc("close_operating_day");
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  const result = data as { ok?: boolean; status?: string };
  if (!result?.ok) return NextResponse.json({ error: "OPERATING_DAY_CLOSE_FAILED" }, { status: 500 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
