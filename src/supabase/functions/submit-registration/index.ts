import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(503, { error: "SERVICE_UNAVAILABLE" });

  let body: { user_id?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "INVALID_REQUEST" }); }
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return reply(400, { error: "INVALID_USER" });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: result, error: userError } = await admin.auth.admin.getUserById(userId);
  const user = result?.user;
  if (userError || !user || user.user_metadata?.signup_flow !== "public_learner" || user.user_metadata?.requested_role !== "STUDENT") {
    return reply(403, { error: "REGISTRATION_NOT_ALLOWED" });
  }
  const formationId = typeof user.user_metadata?.formation_id === "string" ? user.user_metadata.formation_id : "";
  if (!formationId) return reply(400, { error: "FORMATION_REQUIRED" });
  const { data: formation, error: formationError } = await admin.from("formations")
    .select("id").eq("id", formationId).eq("status", "active").maybeSingle();
  if (formationError || !formation) return reply(400, { error: "FORMATION_NOT_AVAILABLE" });

  const { data: existing } = await admin.from("registrations").select("id,registration_number")
    .eq("person_id", user.id).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return reply(200, { ok: true, registration_id: existing.id, registration_number: existing.registration_number, already_submitted: true });

  const metadata = user.user_metadata ?? {};
  const displayName = String(metadata.display_name ?? "").trim();
  if (!displayName) return reply(400, { error: "NAME_REQUIRED" });
  const parts = displayName.split(/\s+/);
  const profile = {
    id: user.id, email: user.email ?? null, display_name: displayName,
    first_name: String(metadata.first_name ?? parts.slice(0, -1).join(" ") ?? displayName),
    last_name: String(metadata.last_name ?? parts.at(-1) ?? ""),
    status: "pending",
  };
  const { error: profileError } = await admin.from("profiles").upsert(profile, { onConflict: "id" });
  if (profileError) return reply(500, { error: "PROFILE_SAVE_FAILED", detail: profileError.message });

  const registrationNumber = "AS-" + new Date().getFullYear() + "-" + user.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const { data: registration, error: registrationError } = await admin.from("registrations").insert({
    registration_number: registrationNumber, person_id: user.id, formation_id: formationId,
    registration_date: new Date().toISOString().slice(0, 10), status: "pending", submitted_at: new Date().toISOString(),
  }).select("id,registration_number").single();
  if (registrationError) return reply(500, { error: "REGISTRATION_SAVE_FAILED", detail: registrationError.message });
  return reply(200, { ok: true, registration_id: registration.id, registration_number: registration.registration_number });
});