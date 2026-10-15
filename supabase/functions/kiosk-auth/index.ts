import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: cors });

  try {
    const body = await req.json();
    const identifier = String(body?.identifier ?? "").trim();
    const password = String(body?.password ?? "");
    if (!identifier || !password) return Response.json({ error: "INVALID_CREDENTIALS" }, { status: 400, headers: cors });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const normalized = identifier.toLowerCase();
    const idHash = await sha256(normalized);
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin.from("kiosk_auth_attempts")
      .select("id", { count: "exact", head: true })
      .eq("identifier_hash", idHash).eq("success", false).gte("attempted_at", since);
    if (countError) return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: cors });
    if ((count ?? 0) >= 5) return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: cors });

    let email = identifier;
    if (!identifier.includes("@")) {
      let resolvedEmail: string | null = null;

      // First accept the exact official student number.
      const { data: student, error: studentError } = await admin.from("students")
        .select("id,profiles!inner(email)").ilike("student_number", identifier).maybeSingle();
      if (!studentError && student && student.profiles && typeof student.profiles.email === "string") {
        resolvedEmail = student.profiles.email;
      }

      // Some learner accounts use the platform's public ID instead of the student number.
      if (!resolvedEmail) {
        const { data: publicProfile, error: publicProfileError } = await admin.from("profiles")
          .select("email").eq("public_id", identifier).maybeSingle();
        if (!publicProfileError && typeof publicProfile?.email === "string" && publicProfile.email.includes("@")) {
          resolvedEmail = publicProfile.email;
        }
      }

      // Also support an exact email username (the part before @), but only when it is unique.
      if (!resolvedEmail && /^[a-zA-Z0-9._%+-]+$/.test(identifier)) {
        const escapedIdentifier = identifier.split("").map((character) => ["\", "%", "_"].includes(character) ? "\" + character : character).join("");
        const { data: emailCandidates, error: emailLookupError } = await admin.from("profiles")
          .select("email").ilike("email", `${escapedIdentifier}@%`).limit(2);
        if (!emailLookupError && emailCandidates?.length === 1 &&
            typeof emailCandidates[0]?.email === "string" && emailCandidates[0].email.includes("@")) {
          resolvedEmail = emailCandidates[0].email;
        }
      }

      if (!resolvedEmail) {
        await admin.from("kiosk_auth_attempts").insert({ identifier_hash: idHash, success: false });
        return Response.json({ error: "INVALID_CREDENTIALS" }, { status: 401, headers: cors });
      }
      email = resolvedEmail;
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session) {
      await admin.from("kiosk_auth_attempts").insert({ identifier_hash: idHash, success: false });
      return Response.json({ error: "INVALID_CREDENTIALS" }, { status: 401, headers: cors });
    }

    const [{ data: profile, error: profileError }, { data: roleRows, error: roleError }] = await Promise.all([
      admin.from("profiles").select("status").eq("id", data.user.id).maybeSingle(),
      admin.from("user_roles").select("roles(code)").eq("user_id", data.user.id),
    ]);
    const roles = (roleRows ?? []).flatMap((row: any) => Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : [])
      .map((role: any) => String(role.code ?? "").toUpperCase());
    if (profileError || roleError || String(profile?.status ?? "").trim().toLowerCase() !== "active" ||
        !roles.some((role: string) => ["STUDENT", "APPRENANT"].includes(role)) ||
        roles.some((role: string) => ["DIRECTOR", "ADMIN", "PRE_ADMIN", "SECRETARY", "SECRETARIAT"].includes(role))) {
      await client.auth.signOut();
      await admin.from("kiosk_auth_attempts").insert({ identifier_hash: idHash, success: false });
      return Response.json({ error: "ACTIVE_STUDENT_REQUIRED" }, { status: 403, headers: cors });
    }

    await admin.from("kiosk_auth_attempts").insert({ identifier_hash: idHash, success: true });
    return Response.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers: cors });
  }
});
