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
const allowedCreateRoles = new Set(["STUDENT", "TEACHER", "STAFF", "TRAVEL_AGENT", "ACCOUNTING", "PEDAGOGY"]);
const privilegedCreators = ["SECRETARIAT", "SECRETARY", "SECRETAIRE", "SECRÉTAIRE", "DIRECTOR", "ADMIN", "PRE_ADMIN"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply(503, { error: "SERVICE_UNAVAILABLE" });

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "AUTH_REQUIRED" });
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerResult, error: callerError } = await authClient.auth.getUser(token);
  if (callerError || !callerResult.user) return reply(401, { error: "AUTH_REQUIRED" });
  const callerId = callerResult.user.id;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: assignedRoles, error: roleError } = await admin.from("user_roles").select("roles(code)").eq("user_id", callerId);
  if (roleError) return reply(503, { error: "ROLE_LOOKUP_FAILED" });
  const codes = (assignedRoles ?? []).flatMap((item: any) => Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : [])
    .map((role: any) => String(role.code).toUpperCase());
  if (!codes.some((code: string) => privilegedCreators.includes(code))) return reply(403, { error: "ROLE_NOT_ALLOWED" });

  let body: { display_name?: unknown; email?: unknown; password?: unknown; phone?: unknown; role_code?: unknown; formation_id?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "INVALID_REQUEST" }); }
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const roleCode = typeof body.role_code === "string" ? body.role_code.toUpperCase() : "";
  const formationId = typeof body.formation_id === "string" ? body.formation_id : "";
  if (displayName.length < 2 || displayName.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) {
    return reply(400, { error: "INVALID_ACCOUNT_DETAILS" });
  }
  if (!allowedCreateRoles.has(roleCode)) return reply(400, { error: "ROLE_NOT_ALLOWED" });
  if (roleCode === "STUDENT" && !formationId) return reply(400, { error: "FORMATION_REQUIRED" });
  if (roleCode === "STUDENT") {
    const { data: formation } = await admin.from("formations").select("id").eq("id", formationId).eq("status", "active").maybeSingle();
    if (!formation) return reply(400, { error: "FORMATION_NOT_AVAILABLE" });
  }

  const parts = displayName.split(/\s+/);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { display_name: displayName, first_name: parts.slice(0, -1).join(" ") || displayName, last_name: parts.length > 1 ? parts.at(-1) : "", phone, requested_role: roleCode, signup_flow: "staff_created" },
  });
  if (createError || !created.user) return reply(400, { error: createError?.message ?? "USER_CREATE_FAILED" });
  const userId = created.user.id;
  const profileStatus = "active";
  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId, email, display_name: displayName,
    first_name: parts.slice(0, -1).join(" ") || displayName,
    last_name: parts.length > 1 ? parts.at(-1) : "", status: profileStatus,
  }, { onConflict: "id" });
  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return reply(500, { error: "PROFILE_CREATE_FAILED", detail: profileError.message });
  }

  const { data: role, error: roleFetchError } = await admin.from("roles").select("id").eq("code", roleCode).maybeSingle();
  if (roleFetchError || !role) {
    await admin.auth.admin.deleteUser(userId);
    return reply(500, { error: "ROLE_NOT_CONFIGURED" });
  }
  const { error: assignmentError } = await admin.from("user_roles").insert({ user_id: userId, role_id: role.id });
  if (assignmentError) {
    await admin.auth.admin.deleteUser(userId);
    return reply(500, { error: "ROLE_ASSIGNMENT_FAILED", detail: assignmentError.message });
  }

  let registrationId: string | null = null;
  let registrationNumber: string | null = null;
  if (roleCode === "STUDENT") {
    registrationNumber = "AS-" + new Date().getFullYear() + "-" + userId.replace(/-/g, "").slice(0, 8).toUpperCase();
    const { data: registration, error: registrationError } = await admin.from("registrations").insert({
      registration_number: registrationNumber, person_id: userId, formation_id: formationId,
      registration_date: new Date().toISOString().slice(0, 10), status: "approved", created_by: callerId, submitted_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), reviewed_by: callerId, review_comment: "Compte créé et activé directement par le secrétariat.",
    }).select("id").single();
    if (registrationError) {
      await admin.auth.admin.deleteUser(userId);
      return reply(500, { error: "REGISTRATION_SAVE_FAILED", detail: registrationError.message });
    }
    registrationId = registration.id;
    const { error: studentError } = await admin.from("students").upsert({
      id: userId,
      formation_id: formationId,
      enrollment_date: new Date().toISOString().slice(0, 10),
      student_number: registrationNumber,
    }, { onConflict: "id" });
    if (studentError) {
      await admin.from("registrations").delete().eq("id", registrationId);
      await admin.from("user_roles").delete().eq("user_id", userId);
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
      return reply(500, { error: "STUDENT_RECORD_CREATE_FAILED", detail: studentError.message });
    }
  }
  return reply(200, { user_id: userId, role_code: roleCode === "STUDENT" ? "Apprenant actif" : roleCode, registration_id: registrationId, registration_number: registrationNumber, profile_status: "active" });
});