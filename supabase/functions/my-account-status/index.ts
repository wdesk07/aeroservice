import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply(503, { error: "SERVICE_UNAVAILABLE" });

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "AUTH_REQUIRED" });

  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "AUTH_REQUIRED" });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = authData.user.id;
  const [
    { data: profile, error: profileError },
    { data: assignedRoles, error: rolesError },
    { data: student, error: studentError },
    { data: registration, error: registrationError },
  ] = await Promise.all([
    admin.from("profiles").select("id,public_id,first_name,last_name,display_name,email,status").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("roles(code,name)").eq("user_id", userId),
    admin.from("students").select("formation_id,student_number,enrollment_date").eq("id", userId).maybeSingle(),
    admin.from("registrations").select("formation_id,status").eq("person_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (profileError || rolesError || studentError || registrationError) return reply(503, { error: "ACCOUNT_LOOKUP_FAILED" });

  const formationId = student?.formation_id ?? registration?.formation_id ?? null;
  let formation = null;
  if (formationId) {
    const { data, error } = await admin.from("formations").select("id,code,name,status").eq("id", formationId).maybeSingle();
    if (error) return reply(503, { error: "FORMATION_LOOKUP_FAILED" });
    formation = data;
  }
  const roles = (assignedRoles ?? []).flatMap((item: any) => Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []);
  return reply(200, {
    profile: profile ?? {
      id: userId,
      email: authData.user.email ?? null,
      display_name: authData.user.user_metadata?.display_name ?? null,
      first_name: authData.user.user_metadata?.first_name ?? null,
      last_name: authData.user.user_metadata?.last_name ?? null,
      status: "unknown",
    },
    roles,
    formation,
    student_number: student?.student_number ?? null,
    enrollment_date: student?.enrollment_date ?? null,
  });
});