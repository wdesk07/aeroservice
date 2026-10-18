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

const allowedRoles = new Set([
  "SECRETARY", "SECRETARIAT", "SECRETAIRE", "SECRÉTAIRE",
  "DIRECTOR", "ADMIN", "PRE_ADMIN",
]);

function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const target = new URL(value);
    if (target.protocol !== "https:" || target.username || target.password) return null;
    const host = target.hostname.toLowerCase();
    if (host !== "aero-service.vercel.app" && !host.endsWith(".vercel.app")) return null;
    return target.origin + "/";
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(503, { error: "SERVICE_UNAVAILABLE" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return reply(401, { error: "AUTH_REQUIRED" });
  const token = authHeader.slice(7);

  const caller = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerData, error: callerError } = await caller.auth.getUser(token);
  if (callerError || !callerData.user) return reply(401, { error: "INVALID_SESSION" });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: roleRows, error: roleError } = await admin
    .from("user_roles").select("roles(code)").eq("user_id", callerData.user.id);
  if (roleError) return reply(503, { error: "ROLE_LOOKUP_FAILED", detail: roleError.message });

  const codes = (roleRows ?? []).flatMap((row: any) =>
    Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : []
  ).map((role: any) => String(role.code ?? "").toUpperCase());
  if (!codes.some((code: string) => allowedRoles.has(code))) {
    return reply(403, { error: "SECRETARIAT_ROLE_REQUIRED" });
  }

  let body: { person_id?: unknown; redirect_to?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "INVALID_REQUEST" }); }

  const personId = typeof body.person_id === "string" ? body.person_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(personId)) {
    return reply(400, { error: "INVALID_USER" });
  }
  const redirectTo = safeRedirect(body.redirect_to);
  if (!redirectTo) return reply(400, { error: "INVALID_REDIRECT", detail: "L’adresse de retour doit être l’URL HTTPS de l’aperçu Aéro Service." });

  // Find an approved registration for this account, rather than checking only
  // the newest registration (a newer pending application must not mask an approved one).
  const { data: registration, error: registrationError } = await admin
    .from("registrations")
    .select("status,registration_number")
    .eq("person_id", personId)
    .ilike("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (registrationError) return reply(503, { error: "REGISTRATION_LOOKUP_FAILED", detail: registrationError.message });
  if (!registration) {
    return reply(200, { ok: false, error: "REGISTRATION_NOT_APPROVED", detail: "Aucune inscription approuvée n’a été trouvée pour ce compte dans la base TEST. Vérifie que l’aperçu et la fonction utilisent le même projet Supabase." });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles").select("email,status").eq("id", personId).maybeSingle();
  if (profileError || !profile) return reply(404, { error: "LEARNER_PROFILE_NOT_FOUND" });
  if (String(profile.status ?? "").toLowerCase() !== "active") {
    return reply(200, { ok: false, error: "ACCOUNT_NOT_ACTIVE", detail: "Le compte doit être actif avant l’envoi du lien." });
  }
  if (typeof profile.email !== "string" || !profile.email.trim()) {
    return reply(200, { ok: false, error: "EMAIL_MISSING", detail: "Aucune adresse e-mail n’est enregistrée pour ce compte." });
  }

  // Ask Supabase Auth to email a real one-time magic link. create_user=false prevents
  // accidentally creating a second account for an already registered learner.
  const authResponse = await fetch(
    `${url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: profile.email.trim(), create_user: false }),
    },
  );

  if (!authResponse.ok) {
    const detailText = await authResponse.text();
    let detail = detailText.slice(0, 500);
    try {
      const parsed = JSON.parse(detailText);
      detail = String(parsed.msg || parsed.message || parsed.error_description || parsed.error || detail);
    } catch { /* keep the bounded response text */ }
    return reply(502, {
      error: "MAGIC_LINK_EMAIL_FAILED",
      detail: detail.toLowerCase().includes("redirect") || detail.toLowerCase().includes("not allowed")
        ? "L’URL de retour de cet aperçu doit être autorisée dans les paramètres URL de Supabase Auth."
        : detail,
    });
  }

  return reply(200, {
    ok: true,
    message: "MAGIC_LINK_SENT",
    registration_number: registration.registration_number,
    account_active: true,
  });
});
