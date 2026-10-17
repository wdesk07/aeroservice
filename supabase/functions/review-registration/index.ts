import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: cors });
const ALLOWED_REVIEWERS = new Set(["SECRETARY", "SECRETARIAT", "SECRETAIRE", "SECRÉTAIRE", "DIRECTOR", "ADMIN", "PRE_ADMIN"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") ?? "";
  if (!url || !serviceKey || !anonKey) return reply(503, { error: "SERVICE_UNAVAILABLE" });
  if (!authorization.startsWith("Bearer ")) return reply(401, { error: "AUTH_REQUIRED" });

  let body: { registration_id?: unknown; decision?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "INVALID_REQUEST" }); }
  const registrationId = typeof body.registration_id === "string" ? body.registration_id : "";
  const decision = String(body.decision ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registrationId)
      || !["approved", "rejected"].includes(decision)) return reply(400, { error: "INVALID_REQUEST" });

  const token = authorization.slice("Bearer ".length);
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return reply(401, { error: "INVALID_SESSION" });
  const callerId = callerData.user.id;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: roleRows, error: roleError } = await admin.from("user_roles").select("roles(code)").eq("user_id", callerId);
  if (roleError) return reply(503, { error: "ROLE_LOOKUP_FAILED" });
  const roleCodes = (roleRows ?? []).flatMap((row: any) => Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : []).map((role: any) => String(role.code ?? "").toUpperCase());
  if (!roleCodes.some((code: string) => ALLOWED_REVIEWERS.has(code))) return reply(403, { error: "SECRETARIAT_ROLE_REQUIRED" });

  const { data: registration, error: registrationError } = await admin.from("registrations")
    .select("id,person_id,formation_id,status,registration_number").eq("id", registrationId).maybeSingle();
  if (registrationError) return reply(503, { error: "REGISTRATION_LOOKUP_FAILED", detail: registrationError.message });
  if (!registration) return reply(404, { error: "REGISTRATION_NOT_FOUND" });
  const alreadyApproved = registration.status === "approved";
  if (alreadyApproved && decision === "rejected") return reply(409, { error: "REGISTRATION_ALREADY_APPROVED" });
  if (!alreadyApproved && registration.status !== "pending") return reply(409, { error: "REGISTRATION_ALREADY_REVIEWED", status: registration.status });

  const now = new Date().toISOString();
  if (decision === "approved") {
    const { data: authResult, error: authError } = await admin.auth.admin.updateUserById(registration.person_id, { email_confirm: true });
    if (authError || !authResult.user) return reply(500, { error: "AUTH_ACTIVATION_FAILED", detail: authError?.message ?? "Compte Auth introuvable." });

    const { data: profile, error: profileError } = await admin.from("profiles").update({ status: "active" })
      .eq("id", registration.person_id).select("id,status").maybeSingle();
    if (profileError || !profile || profile.status !== "active") return reply(500, { error: "PROFILE_ACTIVATION_FAILED", detail: profileError?.message ?? "Profil non activé." });

    const { data: studentRole, error: studentRoleError } = await admin.from("roles").select("id").eq("code", "STUDENT").maybeSingle();
    if (studentRoleError || !studentRole) return reply(500, { error: "STUDENT_ROLE_LOOKUP_FAILED", detail: studentRoleError?.message ?? "Rôle STUDENT introuvable." });
    const { error: roleAssignmentError } = await admin.from("user_roles").upsert(
      { user_id: registration.person_id, role_id: studentRole.id }, { onConflict: "user_id,role_id", ignoreDuplicates: true }
    );
    if (roleAssignmentError) return reply(500, { error: "STUDENT_ROLE_ASSIGNMENT_FAILED", detail: roleAssignmentError.message });

    const { data: existingStudent, error: studentLookupError } = await admin.from("students")
      .select("id,formation_id").eq("id", registration.person_id).maybeSingle();
    if (studentLookupError) return reply(500, { error: "STUDENT_LOOKUP_FAILED", detail: studentLookupError.message });
    if (!existingStudent) {
      const studentNumber = "AS-" + new Date().getFullYear() + "-" + registration.person_id.replace(/-/g, "").slice(0, 8).toUpperCase();
      const { error: studentError } = await admin.from("students").insert({
        id: registration.person_id, student_number: studentNumber, formation_id: registration.formation_id ?? null, enrollment_date: now.slice(0, 10)
      });
      if (studentError) return reply(500, { error: "STUDENT_CREATION_FAILED", detail: studentError.message });
    } else if (!existingStudent.formation_id && registration.formation_id) {
      const { error: formationUpdateError } = await admin.from("students").update({ formation_id: registration.formation_id })
        .eq("id", registration.person_id).is("formation_id", null);
      if (formationUpdateError) return reply(500, { error: "STUDENT_FORMATION_ASSIGNMENT_FAILED", detail: formationUpdateError.message });
    }
  }

  if (!alreadyApproved) {
    const reviewComment = decision === "approved"
      ? "Dossier vérifié et approuvé par le secrétariat."
      : "Demande rejetée par le secrétariat. Veuillez contacter le secrétariat pour plus d’informations.";
    const { data: updated, error: updateError } = await admin.from("registrations").update({
      status: decision, reviewed_at: now, reviewed_by: callerId, review_comment: reviewComment,
    }).eq("id", registrationId).eq("status", "pending").select("id").maybeSingle();
    if (updateError || !updated) return reply(500, { error: "REGISTRATION_UPDATE_FAILED", detail: updateError?.message ?? "Le dossier a changé d’état." });
  }

  return reply(200, {
    ok: true, registration_number: registration.registration_number,
    status: decision, account_active: decision === "approved", email_confirmed: decision === "approved",
    finalized_existing_approval: alreadyApproved,
  });
});