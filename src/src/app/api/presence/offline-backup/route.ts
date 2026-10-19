import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const STAFF_ROLES = ["DIRECTOR", "ADMIN", "PRE_ADMIN", "SECRETARIAT", "SECRETARY", "SECRETAIRE", "SECRÉTAIRE"];

type OfflineEvent = {
  client_event_id?: unknown;
  person_identifier?: unknown;
  person_name?: unknown;
  observed_at?: unknown;
  reason?: unknown;
  device_label?: unknown;
  metadata?: unknown;
};

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: allowed, error: roleError } = await supabase.rpc("has_any_role", { p_roles: STAFF_ROLES });
  if (roleError || allowed !== true) return NextResponse.json({ error: "KIOSK_ADMIN_REQUIRED" }, { status: 403 });

  let body: { events?: OfflineEvent[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 }); }
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 100) {
    return NextResponse.json({ error: "INVALID_BATCH_SIZE" }, { status: 400 });
  }

  const rows = [];
  for (const event of body.events) {
    const clientId = typeof event.client_event_id === "string" ? event.client_event_id : "";
    const identifier = typeof event.person_identifier === "string" ? event.person_identifier.trim() : "";
    const name = typeof event.person_name === "string" ? event.person_name.trim() : "";
    const reason = typeof event.reason === "string" ? event.reason.trim() : "";
    const observedAt = typeof event.observed_at === "string" ? new Date(event.observed_at) : new Date(NaN);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)
      || !identifier || identifier.length > 120 || !name || name.length > 160
      || Number.isNaN(observedAt.getTime()) || !reason || reason.length < 3 || reason.length > 500) {
      return NextResponse.json({ error: "INVALID_EVENT" }, { status: 400 });
    }
    rows.push({
      client_event_id: clientId,
      person_identifier: identifier,
      person_name: name,
      observed_at: observedAt.toISOString(),
      reason,
      device_label: typeof event.device_label === "string" ? event.device_label.slice(0, 120) : "Borne officielle",
      created_by: authData.user.id,
      metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
    });
  }

  const { error: insertError } = await supabase.from("attendance_offline_events").upsert(rows, {
    onConflict: "client_event_id",
    ignoreDuplicates: true,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ ok: true, accepted: rows.length, review_status: "pending_review" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
