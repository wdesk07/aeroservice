import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "METHOD_NOT_ALLOWED" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return response(503, { error: "SERVICE_UNAVAILABLE" });

  let body: { identifier?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return response(400, { error: "INVALID_REQUEST" });
  }

  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || identifier.length > 254 || !password || password.length > 256) {
    return response(400, { error: "INVALID_CREDENTIALS" });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = await hash(forwarded);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("presence_kiosk_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("attempted_at", since);

  if (countError) return response(503, { error: "SERVICE_UNAVAILABLE" });
  if ((count ?? 0) >= 10) return response(429, { error: "TOO_MANY_ATTEMPTS" });

  const { data: attempt, error: attemptError } = await admin
    .from("presence_kiosk_login_attempts")
    .insert({ ip_hash: ipHash, succeeded: false })
    .select("id")
    .single();
  if (attemptError || !attempt) return response(503, { error: "SERVICE_UNAVAILABLE" });

  try {
    let profile: { id: string; email: string | null; status: string | null } | null = null;

    if (identifier.includes("@")) {
      const lookup = await admin.from("profiles").select("id,email,status").ilike("email", identifier).maybeSingle();
      if (!lookup.error && lookup.data) profile = lookup.data;
    } else {
      const byPublicId = await admin.from("profiles").select("id,email,status").eq("public_id", identifier).maybeSingle();
      if (!byPublicId.error && byPublicId.data) profile = byPublicId.data;

      if (!profile) {
        const byStudentNumber = await admin.from("students").select("id").eq("student_number", identifier).maybeSingle();
        if (!byStudentNumber.error && byStudentNumber.data) {
          const byStudentProfile = await admin.from("profiles").select("id,email,status").eq("id", byStudentNumber.data.id).maybeSingle();
          if (!byStudentProfile.error && byStudentProfile.data) profile = byStudentProfile.data;
        }
      }
    }

    if (!profile || profile.status !== "active" || !profile.email) {
      return response(401, { error: "INVALID_CREDENTIALS" });
    }

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("id")
      .eq("id", profile.id)
      .maybeSingle();
    if (studentError || !student) return response(401, { error: "INVALID_CREDENTIALS" });

    const { data: signedIn, error: signInError } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (signInError || !signedIn.session || !signedIn.user) {
      return response(401, { error: "INVALID_CREDENTIALS" });
    }

    await admin.from("presence_kiosk_login_attempts").update({ succeeded: true }).eq("id", attempt.id);

    return response(200, {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      expires_in: signedIn.session.expires_in,
      token_type: signedIn.session.token_type,
      user: signedIn.user,
    });
  } catch {
    return response(401, { error: "INVALID_CREDENTIALS" });
  }
});
