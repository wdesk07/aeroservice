"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { validateManualLateArrival } from "../lib/attendance-validation";
import { classifyArrival } from "../lib/attendance-policy";
import { planLateArrivalSettlement } from "../lib/penalty-settlement";

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Profile = { id: string; public_id?: string | null; first_name?: string | null; last_name?: string | null; display_name?: string | null; email?: string | null; status?: string };
type Role = { code: string; name: string };
type ModuleKey = "dashboard" | "students" | "teachers" | "formations" | "groups" | "subjects" | "rooms" | "registrations" | "attendance" | "myCourses" | "myAttendance" | "myAbsences" | "penalties" | "payments" | "staff" | "roles" | "settings";
type ModuleConfig = { key: ModuleKey; label: string; icon: string; table?: string; columns?: string[]; description: string; section: string };
const modules: ModuleConfig[] = [
  { key: "dashboard", label: "Vue d’ensemble", icon: "⌂", description: "Les indicateurs essentiels de votre établissement.", section: "PILOTAGE" },
  { key: "students", label: "Apprenants", icon: "♙", table: "students", columns: ["id", "student_number", "formation_id", "group_id", "enrollment_date", "education_level"], description: "Suivi des apprenants et de leurs parcours.", section: "PÉDAGOGIE" },
  { key: "teachers", label: "Formateurs", icon: "♧", table: "teachers", columns: ["id", "teacher_number", "specialization", "hire_date", "status"], description: "Équipe pédagogique et affectations.", section: "PÉDAGOGIE" },
  { key: "formations", label: "Formations", icon: "✈", table: "formations", columns: ["code", "name", "duration", "status", "created_at"], description: "Catalogue des formations proposées.", section: "PÉDAGOGIE" },
  { key: "groups", label: "Groupes", icon: "▦", table: "groups", columns: ["code", "name", "academic_year", "capacity", "status"], description: "Organisation des groupes et promotions.", section: "PÉDAGOGIE" },
  { key: "subjects", label: "Matières", icon: "▤", table: "subjects", columns: ["code", "name", "formation_id", "status"], description: "Matières et unités d’enseignement.", section: "PÉDAGOGIE" },
  { key: "rooms", label: "Salles", icon: "⌂", table: "rooms", columns: ["code", "name", "capacity", "location_description", "status"], description: "Salles et espaces de formation.", section: "ORGANISATION" },
  { key: "registrations", label: "Inscriptions", icon: "▣", table: "registrations", columns: ["id", "registration_number", "person_id", "formation_id", "group_id", "registration_date", "status", "submitted_at", "review_comment"], description: "Demandes d’inscription et admissions.", section: "ADMINISTRATION" },
  { key: "attendance", label: "Présences", icon: "◷", table: "daily_attendance", columns: ["local_date", "person_id", "person_type", "nominal_time", "cutoff_time", "arrived_at", "status", "minutes_after_cutoff"], description: "Pointage quotidien et suivi des présences.", section: "ADMINISTRATION" },
  { key: "myCourses", label: "Mes cours", icon: "▤", table: "course_sessions", columns: ["id", "session_date", "planned_start", "planned_end", "formation_id", "group_id", "status"], description: "Consultez les cours et séances prévus pour votre formation ou votre groupe.", section: "ESPACE APPRENANT" },
  { key: "myAttendance", label: "Mes présences", icon: "◷", table: "daily_attendance", columns: ["local_date", "person_type", "nominal_time", "cutoff_time", "arrived_at", "status", "minutes_after_cutoff"], description: "Consultez votre historique personnel de pointage quotidien.", section: "ESPACE APPRENANT" },
  { key: "myAbsences", label: "Justifier une absence", icon: "✎", table: "absence_justifications", columns: ["attendance_id", "reason_type", "reason", "submitted_at", "status", "review_comment"], description: "Envoyez une justification et suivez la réponse du secrétariat ou de la Direction.", section: "ESPACE APPRENANT" },
  { key: "penalties", label: "Pénalités", icon: "⚠", table: "penalties", columns: ["id", "person_id", "penalty_type", "description", "amount_fcfa", "status", "created_at"], description: "Créer et suivre les pénalités, avec leur motif et leur montant.", section: "ADMINISTRATION" },
  { key: "payments", label: "Paiements", icon: "₣", table: "payments", columns: ["id", "payment_type", "payment_category", "penalty_id", "person_id", "payer_name", "payer_phone", "payer_identifier", "payment_description", "amount_fcfa", "method", "provider", "transaction_reference", "status", "received_at", "receipt_number"], description: "Paiements ordinaires et règlement des pénalités.", section: "FINANCES" },
  { key: "staff", label: "Personnel", icon: "♙", table: "staff", columns: ["id", "staff_number", "department", "position", "hire_date", "status"], description: "Personnel administratif et opérationnel.", section: "ADMINISTRATION" },
  { key: "roles", label: "Rôles & accès", icon: "⚿", table: "roles", columns: ["code", "name", "description", "is_system"], description: "Rôles disponibles dans la plateforme.", section: "SYSTÈME" },
  { key: "settings", label: "Paramètres", icon: "⚙", description: "Profil et préférences de session.", section: "SYSTÈME" }
];
const metrics = [
  { label: "Apprenants", table: "students", icon: "♙", foot: "Dossiers apprenants" },
  { label: "Formations", table: "formations", icon: "✈", foot: "Catalogue pédagogique" },
  { label: "Formateurs", table: "teachers", icon: "♧", foot: "Équipe pédagogique" },
  { label: "Inscriptions", table: "registrations", icon: "▣", foot: "Demandes enregistrées" }
];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const statusClass = (v: string) => { const status = v.toLowerCase(); if (["active", "approved", "success", "validated", "present", "paid", "on_time"].includes(status)) return "active"; if (status === "regularized_late" || status === "regularized") return "regularized_late"; if (["pending", "submitted", "pre_review"].includes(status)) return "pending"; if (status === "late") return "late"; if (["suspended", "rejected", "inactive", "absent"].includes(status)) return "rejected"; return ""; };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join("") || "AS";
const escapeHtml = (value: unknown) => String(value ?? "—").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\x27/g,"&#39;");

const roleModules: Record<string, ModuleKey[]> = {
  DIRECTOR: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","absenceReviews","penalties","payments","staff","roles","settings"],
  ADMIN: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","absenceReviews","penalties","payments","staff","roles","settings"],
  PRE_ADMIN: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","absenceReviews","penalties","payments","staff","roles","settings"],
  SECRETARY: ["dashboard","students","registrations","attendance","absenceReviews","penalties","payments","settings"],
  SECRETARIAT: ["dashboard","students","registrations","attendance","absenceReviews","penalties","payments","settings"],
  SECRETAIRE: ["dashboard","students","registrations","attendance","absenceReviews","penalties","payments","settings"],
  "SECRÉTAIRE": ["dashboard","students","registrations","attendance","absenceReviews","penalties","payments","settings"],
  PEDAGOGY: ["dashboard","students","teachers","formations","groups","subjects","attendance","settings"],
  PEDAGOGIE: ["dashboard","students","teachers","formations","groups","subjects","attendance","settings"],
  TEACHER: ["dashboard","groups","subjects","attendance","formations","settings"],
  ENSEIGNANT: ["dashboard","groups","subjects","attendance","formations","settings"],
  STAFF: ["dashboard","attendance","settings"],
  PERSONNEL: ["dashboard","attendance","settings"],
  ACCOUNTING: ["dashboard","penalties","payments","settings"],
  FINANCE: ["dashboard","penalties","payments","settings"],
  TRAVEL_AGENT: ["dashboard","formations","settings"],
  STUDENT: ["dashboard","myCourses","myAttendance","myAbsences","settings"],
  APPRENANT: ["dashboard","myCourses","myAttendance","myAbsences","settings"]
};
const canAccessModule = (key: ModuleKey, roleCodes: string[]) => {
  const normalized = roleCodes.map(code => code.toUpperCase());
  if (normalized.some(code => ["DIRECTOR","ADMIN","PRE_ADMIN"].includes(code))) return true;
  return normalized.some(code => (roleModules[code] ?? ["dashboard","settings"]).includes(key));
};


export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "reset" | "signup" | "recovery">("login");
  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupFormation, setSignupFormation] = useState("");
  const [publicFormations, setPublicFormations] = useState<{id:string;name:string;code:string}[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receiptPayment, setReceiptPayment] = useState<Record<string, unknown> | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [financeTotals, setFinanceTotals] = useState<{today:number|null;month:number|null;year:number|null;pending:number|null;count:number|null}>({today:null,month:null,year:null,pending:null,count:null});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newAccount, setNewAccount] = useState({ display_name: "", email: "", password: "", phone: "", role_code: "STUDENT", formation_id: "" });
  const [mobileNav, setMobileNav] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", duration: "", description: "" });
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [lateForm, setLateForm] = useState({ person_type: "student", person_id: "", planned_time: "09:00", arrived_time: "", amount_fcfa: "", method: "cash", provider: "", transaction_reference: "", reason: "" });
  const [operatingDay, setOperatingDay] = useState<Record<string, any> | null>(null);
  const [newKioskToken, setNewKioskToken] = useState("");
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [penaltyRules, setPenaltyRules] = useState<Record<string, any>[]>([]);
  const [ruleSchemaReady, setRuleSchemaReady] = useState(true);
  const [ruleForm, setRuleForm] = useState({ penalty_type: "late_arrival", description: "", target_scope: "all", application_mode: "automatic", applies_after_time: "08:20", min_delay_minutes: "0", tolerance_minutes: "0", amount_fcfa: "2000" });
  const [applyRuleForm, setApplyRuleForm] = useState({ rule_id: "", person_id: "" });
  const [absenceForm, setAbsenceForm] = useState({ attendance_id: "", reason_type: "illness", reason: "" });
  const [myAbsenceRecords, setMyAbsenceRecords] = useState<Record<string, any>[]>([]);

  const loadIdentity = useCallback(async (current: User) => {
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from("profiles").select("id,public_id,first_name,last_name,display_name,email,status").eq("id", current.id).maybeSingle(),
      supabase.from("user_roles").select("roles(code,name)").eq("user_id", current.id)
    ]);
    setProfile((p as Profile | null) ?? null);
    const roleData = (r ?? []).flatMap((item: any) => Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []) as Role[];
    setRoles(roleData);
  }, []);

  const loadCounts = useCallback(async () => {
    const entries = await Promise.all(metrics.map(async item => {
      const result = await supabase.from(item.table).select("*", { count: "exact", head: true });
      return [item.table, result.error ? null : (result.count ?? 0)] as const;
    }));
    setCounts(Object.fromEntries(entries));
  }, []);

  const loadRows = useCallback(async (key: ModuleKey) => {
    if (!canAccessModule(key, roles.map(role => role.code))) {
      setRows([]); setError("Accès refusé : ce module n’est pas autorisé pour votre rôle."); setLoading(false); return;
    }
    const config = modules.find(m => m.key === key);
    if (!config?.table) { setRows([]); return; }
    setLoading(true); setError("");
    const cols = config.columns?.join(",") || "*";
    let query = supabase.from(config.table).select(cols).limit(100);
    if (key === "myAttendance") query = query.eq("person_id", user?.id ?? "").eq("person_type", "student").order("local_date", { ascending: false });
    if (key === "myAbsences") {
      query = query.eq("person_id", user?.id ?? "").order("submitted_at", { ascending: false });
      const { data: absences } = await supabase.from("daily_attendance").select("id,local_date,status,person_type").eq("person_id", user?.id ?? "").eq("person_type","student").eq("status","absent").order("local_date",{ascending:false});
      setMyAbsenceRecords((absences ?? []) as Record<string, any>[]);
    }
    if (key === "myCourses") {
      const { data: studentRecord, error: studentError } = await supabase.from("students").select("formation_id,group_id").eq("id", user?.id ?? "").maybeSingle();
      if (studentError || !studentRecord || (!studentRecord.formation_id && !studentRecord.group_id)) {
        setRows([]); setError(studentError ? "Impossible de charger votre inscription : " + studentError.message : "Aucune formation ou aucun groupe n’est encore associé à votre compte. Contactez le secrétariat."); setLoading(false); return;
      }
      const conditions = [studentRecord.group_id ? "group_id.eq." + studentRecord.group_id : "", studentRecord.formation_id ? "and(group_id.is.null,formation_id.eq." + studentRecord.formation_id + ")" : ""].filter(Boolean);
      query = query.or(conditions.join(",")).neq("status","cancelled").order("session_date",{ascending:true});
    }
    // Contextual links from a late alert pass the learner's profile UUID.
    // Apply that filter at the database query as well as the visible search.
    const contextId = search.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contextId);
    if (isUuid && key === "payments") query = query.eq("person_id", contextId);
    if (isUuid && key === "students") query = query.eq("id", contextId);
    const result = await query;
    if (result.error) {
      console.error("Aéro Service module query failed", { module: key, code: result.error.code, message: result.error.message });
      setRows([]);
      setError("Impossible de charger ce module. Détail technique : " + (result.error.code || "erreur") + " — " + result.error.message);
    } else setRows((result.data ?? []) as unknown as Record<string, unknown>[]);
    setLoading(false);
  }, [roles, search, user?.id]);

  useEffect(() => {
    if (!user || !roles.some(role => ["ACCOUNTING", "FINANCE"].includes(role.code.toUpperCase()))) {
      setFinanceTotals({today:null,month:null,year:null,pending:null,count:null});
      return;
    }
    let cancelled = false;
    const loadFinanceTotals = async () => {
      const { data, error: paymentsError } = await supabase
        .from("payments")
        .select("amount_fcfa,received_at,status")
        .limit(5000);
      if (cancelled) return;
      if (paymentsError || !data) {
        setFinanceTotals({today:null,month:null,year:null,pending:null,count:null});
        return;
      }
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const startYear = new Date(now.getFullYear(), 0, 1).getTime();
      const rows = data as {amount_fcfa:number|null;received_at:string|null;status:string|null}[];
      const validated = rows.filter(row => ["validated", "paid", "success"].includes((row.status ?? "").toLowerCase()));
      const sumSince = (start:number) => validated.reduce((sum,row) => {
        const timestamp = row.received_at ? new Date(row.received_at).getTime() : NaN;
        return Number.isFinite(timestamp) && timestamp >= start && timestamp <= now.getTime() ? sum + Number(row.amount_fcfa || 0) : sum;
      }, 0);
      setFinanceTotals({
        today: sumSince(startToday),
        month: sumSince(startMonth),
        year: sumSince(startYear),
        pending: rows.filter(row => ["pending", "submitted", "pre_review"].includes((row.status ?? "").toLowerCase())).length,
        count: validated.length
      });
    };
    void loadFinanceTotals();
    return () => { cancelled = true; };
  }, [user, roles]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) setUser(data.session?.user ?? null); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => { if (event === "PASSWORD_RECOVERY") { setMode("recovery"); setError(""); setNotice("Choisissez votre nouveau mot de passe puis enregistrez-le."); } setUser(session?.user ?? null); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setRoles([]); setCounts({}); setRows([]); return; }
    void loadIdentity(user);
    void loadCounts();
  }, [user, loadIdentity, loadCounts]);

  useEffect(() => {
    if (!user || active !== "attendance" || !roles.some(role => ["DIRECTOR","ADMIN","PRE_ADMIN","SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","STAFF","PERSONNEL"].includes(role.code.toUpperCase()))) return;
    let cancelled = false;
    supabase.rpc("get_operating_day_status").then(({data,error:statusError}) => { if (cancelled) return; if (statusError) setError("Impossible de lire l’état de la journée : "+statusError.message); else setOperatingDay((data||null) as Record<string,any>|null); });
    return () => { cancelled = true; };
  }, [user, active, roles]);

  useEffect(() => {
    if (!user) return;
    if (!canAccessModule(active, roles.map(role => role.code))) {
      setActive("dashboard"); setRows([]); setShowCreate(false);
      setError("Le menu demandé n’est pas autorisé pour votre rôle. Vous avez été redirigé vers votre espace.");
      return;
    }
    if (active !== "dashboard" && active !== "settings") void loadRows(active);
  }, [user, active, roles, loadRows]);

  // Open the requested module from a contextual action (e.g. a late-arrival alert).
  // The destination still passes through the same role checks and Supabase RLS policies.
  useEffect(() => {
    if (!user || roles.length === 0 || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedKey = params.get("module");
    if (!requestedKey) return;
    const target = modules.find(item => item.key === requestedKey);
    if (!target || !canAccessModule(target.key, roles.map(role => role.code))) {
      setError("Le module demandé n’est pas autorisé pour votre rôle.");
      return;
    }
    setActive(target.key);
    setSearch(params.get("person_id") ?? "");
    window.history.replaceState({}, "", window.location.pathname);
  }, [user, roles]);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) setError(authError.message);
    else if (data.user) {
      const { data: accountProfile } = await supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
      if (accountProfile?.status === "pending") { await supabase.auth.signOut(); setError("Votre dossier est en attente de validation par le secrétariat. Vous pourrez vous connecter après approbation."); }
      else if (accountProfile?.status === "suspended" || accountProfile?.status === "archived") { await supabase.auth.signOut(); setError("Ce compte est suspendu ou archivé. Veuillez contacter le secrétariat."); }
    }
    setBusy(false);
  }
  async function handleSignup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const parts = signupName.trim().split(/\s+/);
    if (parts.length < 2) { setError("Veuillez saisir votre nom et votre prénom."); setBusy(false); return; }
    const { data, error: signupError } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: signupName.trim(), first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1], phone: signupPhone.trim(), requested_role: "STUDENT", signup_flow: "public_learner", formation_id: signupFormation } }
    });
    if (signupError || !data.user) { setError(signupError?.message || "Création du compte impossible."); setBusy(false); return; }
    const { data: registrationResult, error: registrationError } = await supabase.functions.invoke("submit-registration", { body: { user_id: data.user.id } });
    if (registrationError || registrationResult?.error || !registrationResult?.ok) {
      await supabase.auth.signOut();
      setError("Le compte a été créé, mais la demande n’a pas pu être enregistrée. Contactez le secrétariat avec cette adresse e-mail. " + (registrationResult?.detail || registrationResult?.error || registrationError?.message || ""));
      setMode("login"); setPassword(""); setBusy(false); return;
    }
    await supabase.auth.signOut();
    setNotice("Votre demande d’inscription a bien été enregistrée sous le numéro " + registrationResult.registration_number + ". Le dossier est en attente de validation par le secrétariat.");
    setMode("login"); setPassword(""); setSignupName(""); setSignupPhone(""); setSignupFormation("");
    setBusy(false);
  }
  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/?flow=recovery" });
    if (resetError) setError(resetError.message); else setNotice("Si cette adresse est enregistrée, un lien de réinitialisation sera envoyé. Ouvrez le dernier e-mail pour définir votre nouveau mot de passe.");
    setBusy(false);
  }
  async function handlePasswordUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    if (password.length < 8) { setError("Le nouveau mot de passe doit contenir au moins 8 caractères."); setBusy(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setError(updateError.message); setBusy(false); return; }
    await supabase.auth.signOut();
    setUser(null); setPassword(""); setMode("login");
    setNotice("Votre nouveau mot de passe a été enregistré. Vous pouvez maintenant vous connecter.");
    setBusy(false);
  }
  async function handleSignOut() { await supabase.auth.signOut(); setActive("dashboard"); setNotice(""); }
  const createFields: Record<string, { name: string; label: string; type?: string; required?: boolean; options?: { label: string; value: string }[] }[]> = {
    students: [
      { name: "id", label: "Profil de l’apprenant", type: "profile", required: true },
      { name: "student_number", label: "Matricule apprenant", required: true },
      { name: "formation_id", label: "Formation", type: "formation" },
      { name: "group_id", label: "Groupe", type: "group" },
      { name: "enrollment_date", label: "Date d’inscription", type: "date" },
      { name: "education_level", label: "Niveau d’études" }
    ],
    registrations: [
      { name: "registration_number", label: "Numéro d’inscription", required: true },
      { name: "person_id", label: "Personne", type: "profile", required: true },
      { name: "formation_id", label: "Formation", type: "formation" },
      { name: "group_id", label: "Groupe", type: "group" },
      { name: "registration_date", label: "Date d’inscription", type: "date", required: true },
      { name: "status", label: "Statut", type: "select", required: true, options: [{ label: "En attente", value: "pending" }, { label: "Soumise", value: "submitted" }, { label: "Approuvée", value: "approved" }, { label: "Rejetée", value: "rejected" }, { label: "Annulée", value: "cancelled" }] }
    ],
    groups: [
      { name: "formation_id", label: "Formation", type: "formation", required: true },
      { name: "code", label: "Code du groupe", required: true },
      { name: "name", label: "Nom du groupe", required: true },
      { name: "academic_year", label: "Année académique", required: true },
      { name: "capacity", label: "Capacité", type: "number" }
    ],
    subjects: [
      { name: "code", label: "Code de la matière", required: true },
      { name: "name", label: "Nom de la matière", required: true },
      { name: "formation_id", label: "Formation", type: "formation" },
      { name: "description", label: "Description" }
    ],
    rooms: [
      { name: "code", label: "Code de la salle", required: true },
      { name: "name", label: "Nom de la salle", required: true },
      { name: "capacity", label: "Capacité", type: "number" },
      { name: "location_description", label: "Emplacement" }
    ],
    penalties: [
      { name: "person_id", label: "Personne concernée", type: "profile", required: true },
      { name: "penalty_type", label: "Type de pénalité", type: "select", required: true, options: [{ label: "Retard", value: "late_arrival" }, { label: "Absence injustifiée", value: "unjustified_absence" }, { label: "Départ anticipé", value: "early_departure" }, { label: "Absences répétées", value: "repeated_absence" }, { label: "Non-respect du règlement", value: "noncompliance" }, { label: "Comportement inapproprié", value: "misconduct" }, { label: "Dégradation de matériel", value: "equipment_damage" }, { label: "Perte de matériel", value: "equipment_loss" }, { label: "Perte de badge", value: "badge_loss" }, { label: "Dossier incomplet", value: "incomplete_file" }, { label: "Retard de paiement", value: "late_payment" }, { label: "Accès non autorisé", value: "unauthorized_access" }, { label: "Infraction à la sécurité", value: "safety_violation" }, { label: "Incident / fraude d’examen", value: "exam_misconduct" }, { label: "Autre", value: "other" }] },
      { name: "description", label: "Description / observations" },
      { name: "amount_fcfa", label: "Montant de la pénalité (FCFA)", type: "number", required: true },
      { name: "status", label: "Statut", type: "select", required: true, options: [{ label: "En attente de règlement", value: "pending" }, { label: "Exonérée", value: "waived" }] }
    ],
    payments: [
      { name: "payment_type", label: "Type de paiement", type: "select", required: true, options: [{ label: "Paiement ordinaire", value: "ordinary" }, { label: "Règlement d’une pénalité", value: "penalty" }] },
      { name: "penalty_id", label: "Pénalité à régler", type: "penalty", required: false },
      { name: "payment_category", label: "Nature de la recette", type: "select", required: true, options: [{ label: "Contribution scolaire", value: "school_contribution" }, { label: "Scolarité", value: "tuition" }, { label: "Frais d’inscription", value: "registration_fee" }, { label: "Frais de formation", value: "training_fee" }, { label: "Frais d’examen", value: "exam_fee" }, { label: "Vente de documents", value: "document_sale" }, { label: "Cotisation / adhésion", value: "membership_fee" }, { label: "Prestation de service", value: "service_fee" }, { label: "Frais d’équipement", value: "equipment_fee" }, { label: "Transport", value: "transport_fee" }, { label: "Autre recette", value: "other" }] },
      { name: "person_id", label: "Bénéficiaire lié à la plateforme (facultatif)", type: "profile", required: false },
      { name: "payer_name", label: "Nom du payeur externe (si aucun compte)", required: false },
      { name: "payer_phone", label: "Téléphone du payeur (facultatif)" },
      { name: "payer_identifier", label: "Pièce / identifiant du payeur (facultatif)" },
      { name: "payment_description", label: "Détail de la recette (facultatif)" },
      { name: "amount_fcfa", label: "Montant (FCFA)", type: "number", required: true },
      { name: "method", label: "Mode de paiement", type: "select", required: true, options: [{ label: "Espèces", value: "cash" }, { label: "Mobile Money", value: "mobile_money" }, { label: "Autre", value: "other" }] },
      { name: "provider", label: "Opérateur / précision" },
      { name: "transaction_reference", label: "Référence de transaction" }
    ]
  };
  const [formationOptions, setFormationOptions] = useState<{ id: string; name: string; code: string }[]>([]);
  const [groupOptions, setGroupOptions] = useState<{ id: string; name: string; code: string }[]>([]);
  const [profileOptions, setProfileOptions] = useState<{ id: string; display_name: string | null; first_name: string | null; last_name: string | null; public_id: string | null }[]>([]);
  const [penaltyOptions, setPenaltyOptions] = useState<{ id: string; person_id: string; amount_fcfa: number; status: string; penalty_type?: string | null; description?: string | null }[]>([]);
  useEffect(() => {
    if (user && ["students", "groups", "subjects", "registrations"].includes(active)) {
      supabase.from("formations").select("id,name,code").order("name").then(({ data }) => setFormationOptions((data ?? []) as { id: string; name: string; code: string }[]));
    }
    if (user && ["students", "registrations", "attendance", "penalties", "payments"].includes(active)) {
      supabase.from("groups").select("id,name,code").order("name").then(({ data }) => setGroupOptions((data ?? []) as { id: string; name: string; code: string }[]));
      supabase.from("profiles").select("id,display_name,first_name,last_name,public_id").order("last_name").limit(300).then(({ data }) => setProfileOptions((data ?? []) as { id: string; display_name: string | null; first_name: string | null; last_name: string | null; public_id: string | null }[]));
      supabase.from("staff").select("id").then(({ data }) => setStaffIds((data ?? []).map((item: { id: string }) => item.id)));
      supabase.from("students").select("id").then(({ data }) => setStudentIds((data ?? []).map((item: { id: string }) => item.id)));
      supabase.from("teachers").select("id").then(({ data }) => setTeacherIds((data ?? []).map((item: { id: string }) => item.id)));
      if (active === "payments") {
        supabase.from("penalties").select("id,person_id,amount_fcfa,status,penalty_type,description").in("status", ["pending", "unpaid", "due", "open"]).gt("amount_fcfa", 0).order("created_at", { ascending: true }).then(({ data, error }) => {
          setPenaltyOptions(error ? [] : (data ?? []) as { id: string; person_id: string; amount_fcfa: number; status: string; penalty_type?: string | null; description?: string | null }[]);
        });
      } else setPenaltyOptions([]);
      if (active === "penalties") {
        supabase.from("penalty_rules").select("id,person_type,min_delay_minutes,max_delay_minutes,amount_fcfa,tolerance_minutes,blocks_access,priority,active,effective_from,effective_until,created_by,created_at,penalty_type,description,target_scope,application_mode,applies_after_time").order("priority", { ascending: true }).then(({ data, error }) => {
          setRuleSchemaReady(!error);
          setPenaltyRules(error ? [] : (data ?? []) as Record<string, any>[]);
        });
      } else { setPenaltyRules([]); setRuleSchemaReady(true); }
    }
  }, [user, active]);

  async function createPenaltyRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const allowed = roles.some(role => ["DIRECTOR","ADMIN"].includes(role.code.toUpperCase()));
    if (!allowed || !user) { setError("Seul le Directeur ou l’Administrateur peut créer une règle générale."); return; }
    if (ruleForm.application_mode === "automatic" && ruleForm.penalty_type !== "late_arrival") { setError("Pour le moment, l’application automatique est disponible pour les retards enregistrés au pointage. Utilisez le mode manuel pour les autres motifs."); return; }
    const amount = Number(ruleForm.amount_fcfa), minDelay = Number(ruleForm.min_delay_minutes), tolerance = Number(ruleForm.tolerance_minutes);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(minDelay) || minDelay < 0 || !Number.isSafeInteger(tolerance) || tolerance < 0) { setError("Vérifiez le montant, le délai minimum et la tolérance."); return; }
    setBusy(true); setError(""); setNotice("");
    const legacyPersonType = ruleForm.target_scope === "all" ? "student" : ruleForm.target_scope === "students" ? "student" : ruleForm.target_scope;
    const { data, error: saveError } = await supabase.from("penalty_rules").insert({
      person_type: legacyPersonType, penalty_type: ruleForm.penalty_type, description: ruleForm.description.trim() || null,
      target_scope: ruleForm.target_scope, application_mode: ruleForm.application_mode, applies_after_time: ruleForm.applies_after_time || null,
      min_delay_minutes: minDelay, max_delay_minutes: null, tolerance_minutes: tolerance, amount_fcfa: amount,
      blocks_access: false, priority: 100, active: true, effective_from: new Date().toISOString(), created_by: user.id
    }).select("id").single();
    if (saveError || !data) setError(saveError?.message || "La règle n’a pas pu être créée. Vérifiez la migration des règles générales sur la base de test.");
    else {
      setNotice("Règle générale enregistrée. " + (ruleForm.application_mode === "automatic" ? "Les prochaines présences correspondantes pourront générer une pénalité automatiquement." : "Elle est prête à être appliquée manuellement."));
      setRuleForm({ ...ruleForm, description: "" });
      const refreshed = await supabase.from("penalty_rules").select("id,person_type,min_delay_minutes,max_delay_minutes,amount_fcfa,tolerance_minutes,blocks_access,priority,active,effective_from,effective_until,created_by,created_at,penalty_type,description,target_scope,application_mode,applies_after_time").order("priority", { ascending: true });
      if (!refreshed.error) setPenaltyRules((refreshed.data ?? []) as Record<string, any>[]);
      await loadRows("penalties");
    }
    setBusy(false);
  }

  async function applyPenaltyRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Only DIRECTOR and ADMIN may apply a general rule as a penalty.
    const allowed = roles.some(role => ["DIRECTOR","ADMIN"].includes(role.code.toUpperCase()));
    if (!allowed || !user) { setError("Seul le Directeur ou l’Administrateur peut attribuer une pénalité."); return; }
    const rule = penaltyRules.find(item => item.id === applyRuleForm.rule_id && item.active && item.application_mode === "manual");
    if (!rule || !applyRuleForm.person_id) { setError("Choisissez une règle manuelle active et une personne concernée."); return; }
    const inScope = rule.target_scope === "all" || (rule.target_scope === "staff" && staffIds.includes(applyRuleForm.person_id)) || (rule.target_scope === "teacher" && teacherIds.includes(applyRuleForm.person_id)) || (rule.target_scope === "students" && studentIds.includes(applyRuleForm.person_id));
    if (!inScope) { setError("La personne choisie ne correspond pas au public visé par cette règle."); return; }
    setBusy(true); setError(""); setNotice("");
    const person = profileOptions.find(item => item.id === applyRuleForm.person_id);
    const { error: applyError } = await supabase.from("penalties").insert({
      person_id: applyRuleForm.person_id, rule_id: rule.id, amount_fcfa: Number(rule.amount_fcfa), status: "pending",
      penalty_type: rule.penalty_type || "other", description: [rule.description, "Application manuelle de la règle générale"].filter(Boolean).join(" — ")
    });
    if (applyError) setError(applyError.message);
    else {
      setNotice("Pénalité attribuée à " + (person?.display_name || [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "la personne") + ". Elle apparaît dans « Pénalité à régler ».");
      setApplyRuleForm({ rule_id: "", person_id: "" }); await loadRows("penalties"); await loadCounts();
    }
    setBusy(false);
  }

  async function createAccountForRegistration(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canCreateStaffAccount) { setError("Seul le secrétariat ou la direction peut créer un compte."); return; }
    setBusy(true); setError(""); setNotice("");
    const { data, error: accountError } = await supabase.functions.invoke("secretariat-create-account", {
      body: { display_name: newAccount.display_name.trim(), email: newAccount.email.trim(), password: newAccount.password, phone: newAccount.phone.trim(), role_code: newAccount.role_code, formation_id: newAccount.formation_id || null }
    });
    if (accountError || data?.error || !data?.user_id) {
      setError(data?.error || accountError?.message || "Impossible de créer le compte.");
      setBusy(false);
      return;
    }
    const parts = newAccount.display_name.trim().split(/\s+/);
    const createdProfile = { id: data.user_id, display_name: newAccount.display_name.trim(), first_name: parts.slice(0, -1).join(" ") || newAccount.display_name.trim(), last_name: parts.length > 1 ? parts[parts.length - 1] : "", public_id: null };
    setProfileOptions(current => [createdProfile, ...current.filter(item => item.id !== data.user_id)]);
    if (data.role_code === "STUDENT") {
      setNotice("Compte apprenant créé. La demande d’inscription " + (data.registration_number || "") + " est enregistrée et attend la validation du secrétariat.");
      setNewAccount({ display_name: "", email: "", password: "", phone: "", role_code: "STUDENT", formation_id: "" });
    } else {
      setNotice("Compte créé et rôle attribué : " + data.role_code + ". L’utilisateur peut maintenant se connecter avec les identifiants créés.");
      setNewAccount({ display_name: "", email: "", password: "", phone: "", role_code: "STUDENT", formation_id: "" });
    }
    setBusy(false);
  }

  async function createModuleRecord(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const canRecordPayment = roles.some(role => ["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()));
    const canCreatePenalty = roles.some(role => ["DIRECTOR","ADMIN"].includes(role.code.toUpperCase()));
    const canCreateActiveRecord = active === "payments" ? canRecordPayment : active === "penalties" ? canCreatePenalty : (isAdmin || (isSecretary && active === "registrations"));
    if (!canCreateActiveRecord || !createFields[active]) return;
    setBusy(true); setError(""); setNotice("");
    const payload: Record<string, unknown> = {};
    for (const field of createFields[active]) {
      const value = (createValues[field.name] ?? "").trim();
      if (active === "payments" && field.name === "penalty_id" && (createValues.payment_type ?? "ordinary") !== "penalty") continue;
      if (active === "students" && field.name === "id") payload.id = value;
      else if (field.type === "number") payload[field.name] = value ? Number(value) : null;
      else payload[field.name] = value || null;
    }
    if (active === "registrations") { payload.created_by = user?.id; payload.submitted_at = new Date().toISOString(); }
    if (active === "penalties") { payload.amount_fcfa = Number(payload.amount_fcfa); payload.status = payload.status || "pending"; }
    if (active === "payments") {
      const paymentType = String(payload.payment_type ?? "");
      if (paymentType !== "ordinary" && paymentType !== "penalty") {
        setError("Choisissez un type de paiement valide."); setBusy(false); return;
      }
      if (paymentType === "penalty") {
        // Une opération liée à une pénalité doit toujours être catégorisée comme telle,
        // même si le formulaire conserve une ancienne catégorie de recette ordinaire.
        payload.payment_category = "penalty";
        if (typeof payload.penalty_id !== "string" || !payload.penalty_id) {
          setError("Sélectionnez une pénalité en attente avant d’enregistrer le paiement."); setBusy(false); return;
        }
        const selectedPenalty = penaltyOptions.find(item => item.id === payload.penalty_id && item.status === "pending" && Number(item.amount_fcfa) > 0);
        if (!selectedPenalty) {
          setError("Cette pénalité n’est plus disponible. Actualisez la liste puis réessayez."); setBusy(false); return;
        }
        // Le trigger Supabase recalcule le bénéficiaire et le montant depuis la pénalité.
        payload.person_id = null;
        payload.amount_fcfa = null;
      } else {
        const personId = String(payload.person_id ?? "");
        const amount = Number(payload.amount_fcfa);
        const payerName = String(payload.payer_name ?? "").trim();
        if (personId && !profileOptions.some(item => item.id === personId)) {
          setError("Le bénéficiaire sélectionné n’est pas reconnu. Actualisez la liste puis réessayez."); setBusy(false); return;
        }
        if (!personId && !payerName) {
          setError("Choisissez un bénéficiaire de la plateforme ou saisissez le nom du payeur externe."); setBusy(false); return;
        }
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          setError("Le montant ordinaire doit être un nombre entier strictement positif."); setBusy(false); return;
        }
        payload.person_id = personId || null;
        payload.payer_name = payerName || (personId ? (profileOptions.find(item => item.id === personId)?.display_name || [profileOptions.find(item => item.id === personId)?.first_name, profileOptions.find(item => item.id === personId)?.last_name].filter(Boolean).join(" ")) : null);
        payload.payment_category = String(payload.payment_category || "other");
        payload.amount_fcfa = amount;
        payload.penalty_id = null;
      }
      payload.status = "pending";
      payload.receipt_number = null;
    }
    const { error: insertError } = await supabase.from(active).insert(payload);
    if (insertError) {
      if (active === "payments" && insertError.message.includes("PENALTY_REQUIRED")) {
        const type = String(payload.payment_type ?? "");
        setError(
          "La base a refusé l’enregistrement car elle a interprété l’opération comme un règlement de pénalité sans identifiant de pénalité. Aucun paiement n’a été confirmé. " +
          (type === "ordinary"
            ? "Vérifiez que « Paiement ordinaire » est sélectionné, puis réessayez."
            : "Actualisez les pénalités et sélectionnez une pénalité encore en attente.") +
          " Détail technique : " + insertError.message
        );
        if (type === "penalty") {
          const { data: latestPenalties } = await supabase.from("penalties")
            .select("id,person_id,amount_fcfa,status,penalty_type,description")
            .in("status", ["pending", "unpaid", "due", "open"])
            .gt("amount_fcfa", 0)
            .order("created_at", { ascending: true });
          setPenaltyOptions((latestPenalties ?? []) as { id: string; person_id: string; amount_fcfa: number; status: string; penalty_type?: string | null; description?: string | null }[]);
        }
      } else setError(insertError.message);
    } else {
      setNotice(active === "payments" ? "Paiement enregistré en attente de validation. Aucun reçu n’a été émis." : "Enregistrement créé avec succès.");
      setCreateValues({}); setShowCreate(false);
      await loadRows(active); await loadCounts();
    }
    setBusy(false);
  }

  async function registerLateArrival(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user || !lateForm.person_id || Number(lateForm.amount_fcfa) <= 0 || (!isAdmin && lateForm.person_type !== "student")) {
      setError("Choisissez un apprenant et saisissez un montant payé supérieur à zéro. Seule la direction peut valider l’accès du personnel.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const policy = classifyArrival(lateForm.person_type, lateForm.arrived_time);
    if (!policy.ok) {
      setError("error" in policy ? policy.error : "Impossible de classifier l’arrivée.");
      setBusy(false); return;
    }
    if (!policy.late) {
      setError(lateForm.person_type === "student"
        ? "L’arrivée est dans la marge de tolérance des apprenants (jusqu’à 09 h 15). Aucun retard ni pénalité ne doit être enregistré."
        : "Le personnel est à l’heure jusqu’à 08 h 30 inclus. Aucun retard ni pénalité ne doit être enregistré.");
      setBusy(false); return;
    }
    const validation = validateManualLateArrival(
      policy.nominalTime, lateForm.arrived_time, lateForm.amount_fcfa
    );
    if (!validation.ok) {
      setError(validation.error);
      setBusy(false); return;
    }
    const { plannedAt, arrivedAt, delayMinutes, amount } = validation;
    const personLabel = lateForm.person_type === "staff" ? "Personnel" : "Apprenant";
    const note = `${personLabel} — retard ${delayMinutes} min. Montant payé : ${amount.toLocaleString("fr-FR")} FCFA. Accès autorisé par le secrétariat après validation du règlement.${lateForm.reason.trim() ? " Motif : " + lateForm.reason.trim() : ""}`;
    const dateParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(arrivedAt);
    const datePart = (type: string) => dateParts.find(part => part.type === type)?.value ?? "";
    const localDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
    const { data: existingDaily, error: existingDailyError } = await supabase
      .from("daily_attendance").select("id,status,person_type,nominal_time,cutoff_time")
      .eq("person_id", lateForm.person_id).eq("local_date", localDate).maybeSingle();
    if (existingDailyError) {
      setError("Impossible de vérifier le pointage du jour. Aucun paiement ni déblocage n’a été effectué. Détail : " + existingDailyError.message);
      setBusy(false); return;
    }
    if (existingDaily && existingDaily.status !== "late") {
      setError("Un pointage existe déjà pour cette personne aujourd’hui avec le statut « " + existingDaily.status + " ». Aucun doublon ni paiement n’a été créé.");
      setBusy(false); return;
    }
    let dailyAttendanceId = existingDaily?.id as string | undefined;
    if (!dailyAttendanceId) {
      const { data: insertedDaily, error: insertDailyError } = await supabase.from("daily_attendance").insert({
        person_id: lateForm.person_id,
        local_date: localDate,
        person_type: lateForm.person_type,
        nominal_time: policy.nominalTime,
        cutoff_time: lateForm.person_type === "student" ? "09:15:00" : "08:30:00",
        arrived_at: arrivedAt.toISOString(),
        status: "late",
        minutes_after_cutoff: Math.max(0, delayMinutes - (lateForm.person_type === "student" ? 15 : 30))
      }).select("id").single();
      if (insertDailyError || !insertedDaily) {
        setError("Le retard n’a pas pu être lié au pointage quotidien. Aucun paiement ni déblocage n’a été effectué. Détail : " + (insertDailyError?.message || "pointage introuvable"));
        setBusy(false); return;
      }
      dailyAttendanceId = insertedDaily.id;
    }
    const attendanceResult = { data: { id: dailyAttendanceId }, error: null as null };
    const automaticPenalty = await supabase.from("penalties").select("id,amount_fcfa,status").eq("daily_attendance_id", attendanceResult.data.id).maybeSingle();
    if (automaticPenalty.error) {
      setError("Le pointage est enregistré, mais la pénalité automatique n’a pas pu être vérifiée. Aucun accès n’est autorisé. Détail : " + automaticPenalty.error.message);
      await loadRows("attendance"); setBusy(false); return;
    }
    const settlementPlan = planLateArrivalSettlement(automaticPenalty.data, amount);
    if (!settlementPlan.ok) {
      setError(settlementPlan.error);
      await loadRows("attendance"); await loadRows("penalties"); setBusy(false); return;
    }
    let penaltyId = settlementPlan.penaltyId ?? undefined;
    const paymentAmount = settlementPlan.paymentAmount;
    if (settlementPlan.needsPenalty) {
      const penaltyResult = await supabase.from("penalties").insert({
        daily_attendance_id: attendanceResult.data.id, person_id: lateForm.person_id,
        amount_fcfa: amount, status: "pending", penalty_type: "late_arrival", description: note
      }).select("id").single();
      if (penaltyResult.error || !penaltyResult.data) {
        setError("Le retard est enregistré, mais le dossier de règlement n’a pas pu être créé. L’accès reste bloqué. Détail : " + (penaltyResult.error?.message || "erreur inconnue"));
        await loadRows("attendance"); setBusy(false); return;
      }
      penaltyId = penaltyResult.data.id;
    }
    // Fail locally with a precise message rather than sending a penalty payment
    // that the database must reject with PENALTY_REQUIRED.
    if (typeof penaltyId !== "string" || !penaltyId.trim()) {
      setError("Le retard est enregistré, mais aucune pénalité liée n’a été identifiée. Aucun paiement n’a été créé et l’accès reste bloqué. Actualisez les pénalités puis contactez la direction si le problème persiste.");
      await loadRows("attendance"); await loadRows("penalties"); setBusy(false); return;
    }
    const paymentResult = await supabase.from("payments").insert({
      payment_type: "penalty", payment_category: "penalty",
      penalty_id: penaltyId, person_id: lateForm.person_id,
      amount_fcfa: paymentAmount, method: lateForm.method,
      provider: lateForm.provider.trim() || null,
      transaction_reference: lateForm.transaction_reference.trim() || null,
      status: "pending"
    }).select("id").single();
    if (paymentResult.error || !paymentResult.data) {
      setError("Le retard est enregistré, mais la création du paiement a échoué. La pénalité reste à régler. L’accès reste bloqué. Détail : " + (paymentResult.error?.message || "paiement introuvable"));
      await loadRows("attendance"); await loadRows("penalties"); setBusy(false); return;
    }
    const validationResult = await supabase.from("payments")
      .update({ status: "validated" })
      .eq("id", paymentResult.data.id)
      .eq("status", "pending")
      .select("id,status")
      .maybeSingle();
    if (validationResult.error || validationResult.data?.status !== "validated") {
      setError("Le paiement a été créé, mais sa validation n’a pas été confirmée par la base. La pénalité reste à régler et l’accès reste bloqué. Détail : " + (validationResult.error?.message || "Aucune ligne validée n’a été retournée."));
      await loadRows("attendance"); await loadRows("penalties"); await loadRows("payments"); setBusy(false); return;
    }
    const accessResult = await supabase.from("daily_attendance")
      .select("id,status").eq("id", attendanceResult.data.id).maybeSingle();
    if (accessResult.error || accessResult.data?.status !== "regularized") {
      setError("Le paiement est validé, mais la régularisation du pointage n’est pas confirmée. L’accès reste à vérifier par la direction. Détail : " + (accessResult.error?.message || "Le statut du pointage n’est pas regularized."));
    } else {
      setNotice(`Retard enregistré : ${delayMinutes} minute(s). Paiement de ${paymentAmount.toLocaleString("fr-FR")} FCFA validé. Accès autorisé — dossier affiché en jaune.`);
      setLateForm({ person_type: "student", person_id: "", planned_time: "09:00", arrived_time: "", amount_fcfa: "", method: "cash", provider: "", transaction_reference: "", reason: "" });
    }
    await loadRows("attendance"); await loadCounts(); setBusy(false);
  }

  function printReceipt(payment: Record<string, unknown>) {
    const popup = window.open("", "_blank", "width=760,height=850");
    if (!popup) { setError("Autorisez la fenêtre d’impression pour ouvrir le reçu."); return; }
    const labels: Record<string,string> = {school_contribution:"Contribution scolaire",tuition:"Scolarité",registration_fee:"Frais d’inscription",training_fee:"Frais de formation",exam_fee:"Frais d’examen",document_sale:"Vente de documents",membership_fee:"Cotisation / adhésion",service_fee:"Prestation de service",equipment_fee:"Frais d’équipement",transport_fee:"Transport",penalty:"Pénalité",other:"Autre recette"};
    const p = profileOptions.find(item => item.id === String(payment.person_id));
    const payer = payment.payer_name || p?.display_name || [p?.first_name,p?.last_name].filter(Boolean).join(" ") || "Personne extérieure";
    const category = labels[String(payment.payment_category || "")] || (payment.payment_type === "penalty" ? "Pénalité" : "Autre recette");
    const amount = Number(payment.amount_fcfa || 0).toLocaleString("fr-FR");
    const date = payment.validated_at ? new Date(String(payment.validated_at)).toLocaleString("fr-FR") : new Date().toLocaleString("fr-FR");
    const html = "<!doctype html><html lang=\x22fr\x22><head><meta charset=\x22utf-8\x22><title>Reçu Aéro Service</title><style>body{font:16px Arial,sans-serif;color:#172033;padding:36px;max-width:720px;margin:auto}header{text-align:center;border-bottom:2px solid #172033;padding-bottom:18px;margin-bottom:24px}h1{font-size:25px;margin:0 0 8px}.number{font-size:20px;font-weight:bold;margin:18px 0}.line{display:flex;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid #dbe2ea}.line b{text-align:right}.amount{font-size:22px;font-weight:bold}.foot{margin-top:35px;font-size:12px;color:#586579;text-align:center}@media print{button{display:none}body{padding:0}}</style></head><body><header><img src=\x22/logo-aero-services.jpg\x22 alt=\x22Logo Aéro Service\x22 style=\x22width:140px;height:80px;object-fit:contain;margin-bottom:8px\x22><h1>AÉRO SERVICE</h1><div>Reçu officiel de paiement</div><small>Gestion &amp; formation</small></header><div class=\x22number\x22>N° " + escapeHtml(payment.receipt_number) + "</div><div class=\x22line\x22><span>Payeur / bénéficiaire</span><b>" + escapeHtml(payer) + "</b></div><div class=\x22line\x22><span>Nature du paiement</span><b>" + escapeHtml(category) + "</b></div><div class=\x22line\x22><span>Description</span><b>" + escapeHtml(payment.payment_description || payment.transaction_reference || "—") + "</b></div><div class=\x22line\x22><span>Mode de paiement</span><b>" + escapeHtml(payment.method || "Non précisé") + "</b></div><div class=\x22line\x22><span>Date de validation</span><b>" + escapeHtml(date) + "</b></div><div class=\x22line\x22><span>Montant reçu</span><b class=\x22amount\x22>" + escapeHtml(amount) + " FCFA</b></div><div class=\x22foot\x22>Conservez ce reçu comme preuve de paiement.</div><p style=\x22text-align:center;margin-top:30px\x22><button onclick=\x22window.print()\x22>Imprimer / Enregistrer en PDF</button></p></body></html>";
    popup.document.write(html); popup.document.close(); popup.focus(); popup.print();
  }

  async function validatePayment(payment: Record<string, unknown>) {
    const canValidate = roles.some(role => ["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()));
    if (!user || !canValidate) { setError("Vous n’avez pas l’autorisation de valider ce paiement."); return; }
    const paymentId = String(payment.id ?? "");
    const status = String(payment.status ?? "").toLowerCase();
    if (!paymentId || status !== "pending") {
      setError("Ce paiement n’est pas en attente ou son identifiant est manquant."); return;
    }
    const amount = Number(payment.amount_fcfa);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Montant du paiement invalide : validation annulée."); return; }
    setBusy(true); setError(""); setNotice("");
    const { data: updatedPayment, error: updateError } = await supabase.from("payments")
      .update({ status: "validated" })
      .eq("id", paymentId).eq("status", "pending")
      .select("id,payment_type,payment_category,penalty_id,person_id,payer_name,payer_phone,payer_identifier,payment_description,amount_fcfa,method,provider,transaction_reference,status,received_at,validated_at,receipt_number").maybeSingle();
    if (updateError || !updatedPayment) {
      setError("Le paiement n’a pas été validé. Aucune validation n’est confirmée par la base. " + (updateError?.message || "Il a peut-être déjà été traité."));
    } else {
      setReceiptPayment(updatedPayment as Record<string, unknown>);
      setNotice("Paiement validé par votre compte. Le reçu n° " + String(updatedPayment.receipt_number || "—") + " est disponible ci-dessous et dans la liste des paiements.");
      await loadRows("payments");
      await loadCounts();
    }
    setBusy(false);
  }

  async function reviewRegistration(registration: Record<string, unknown>, decision: "approved" | "rejected") {
    if (!user || !isSecretary) {
      setError("Vous n’avez pas l’autorisation de traiter cette inscription. Reconnectez-vous avec le compte du secrétariat.");
      return;
    }
    const registrationId = String(registration.id ?? "");
    if (!registrationId) {
      setError("Dossier incomplet : identifiant de demande manquant.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const { data: result, error: reviewError } = await supabase.functions.invoke("review-registration", {
      body: { registration_id: registrationId, decision },
    });
    if (reviewError || !result?.ok) {
      const reason = result?.detail || result?.error || reviewError?.message || "Réponse du serveur incomplète.";
      setError(decision === "approved"
        ? "La validation n’est pas confirmée. Le compte ne doit pas être considéré comme actif. " + reason
        : "Le rejet du dossier n’a pas été confirmé. " + reason);
      await loadRows("registrations");
      setBusy(false);
      return;
    }
    if (decision === "approved" && result.account_active && result.email_confirmed) {
      setNotice("VALIDATION CONFIRMÉE : dossier approuvé, e-mail confirmé par le serveur et compte apprenant activé. L’apprenant peut maintenant se connecter.");
    } else if (decision === "rejected") {
      setNotice("Demande d’inscription rejetée et décision enregistrée.");
    } else {
      setError("La réponse du serveur ne confirme pas toutes les étapes d’activation.");
    }
    await loadRows("registrations");
    await loadCounts();
    setBusy(false);
  }

  async function createFormation(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const { error: insertError } = await supabase.from("formations").insert({ code: form.code.trim(), name: form.name.trim(), duration: form.duration.trim() || null, description: form.description.trim() || null });
    if (insertError) setError(insertError.message);
    else { setNotice("Formation créée."); setForm({ code: "", name: "", duration: "", description: "" }); setShowCreate(false); await loadRows("formations"); await loadCounts(); }
    setBusy(false);
  }

  const activeModule = modules.find(m => m.key === active) ?? modules[0];
  const fullName = profile?.display_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || user?.email || "Utilisateur";
  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(row => Object.values(row).some(value => String(value ?? "").toLowerCase().includes(q)));
  }, [rows, search]);
  const isAdmin = roles.some(r => ["DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(r.code.toUpperCase()));
  const canManagePenalties = roles.some(r => ["DIRECTOR", "ADMIN"].includes(r.code.toUpperCase()));
  const isSecretary = roles.some(r => ["SECRETARY", "SECRETARIAT", "SECRETAIRE", "SECRÉTAIRE", "DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(r.code.toUpperCase()));
  // Keep account-creation UI aligned with the Edge Function authorization check.
  const canCreateStaffAccount = roles.some(r => ["SECRETARIAT", "SECRETARY", "SECRETAIRE", "SECRÉTAIRE", "DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(r.code.toUpperCase()));
  const roleCodes = roles.map(r => r.code.toUpperCase());
  const visibleModules = modules.filter(m => canAccessModule(m.key, roleCodes));
  const isLearner = roleCodes.some(code => ["STUDENT","APPRENANT"].includes(code));
  const roleLabel = isAdmin ? "Direction / Administration" : isSecretary ? "Secrétariat" : roleCodes.some(code => ["PEDAGOGY","PEDAGOGIE"].includes(code)) ? "Pédagogie" : roleCodes.some(code => ["TEACHER","ENSEIGNANT"].includes(code)) ? "Enseignant" : roleCodes.some(code => ["ACCOUNTING","FINANCE"].includes(code)) ? "Comptabilité / Finance" : roleCodes.some(code => ["STAFF","PERSONNEL"].includes(code)) ? "Personnel" : isLearner ? "Apprenant" : "Accès à définir";

  useEffect(() => {
    if (mode !== "signup") return;
    let cancelled = false;
    setError("");
    supabase.from("formations").select("id,name,code").eq("status", "active").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setPublicFormations([]);
        setError("Impossible de charger les formations depuis le catalogue. Actualisez la page ou contactez le secrétariat.");
        return;
      }
      const priority: Record<string, number> = { PNC: 0, AGENT_ESCALE: 1, AGENT_BILLETTERIE: 2, AGENT_VOYAGE: 3 };
      const options = ((data ?? []) as { id: string; name: string; code: string }[])
        .sort((a, b) => (priority[a.code] ?? 99) - (priority[b.code] ?? 99) || a.name.localeCompare(b.name));
      setPublicFormations(options);
      if (options.length === 0) setError("Aucune formation active n’est disponible. Veuillez contacter le secrétariat.");
    });
    return () => { cancelled = true; };
  }, [mode]);

  if (!user || mode === "recovery") return <main className="login-screen">
    <section className="login-visual">
      <div className="brand"><div className="brand-mark"><img src="/logo-aero-services.jpg" alt="Logo Aéro Service" /></div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Plateforme de gestion</div></div></div>
      <div className="login-visual-content"><div className="eyebrow" style={{color:"#9cc5ff"}}>FORMATION · ORGANISATION · SUIVI</div><h1>Prenez de la hauteur sur votre gestion.</h1><p>Un espace centralisé pour piloter les formations, suivre les apprenants et coordonner les opérations de votre établissement.</p><div className="login-bullets"><span>✦ Gestion pédagogique</span><span>✦ Suivi administratif</span><span>✦ Accès sécurisé</span></div></div>
      <div style={{fontSize:11,color:"#9db2c8",position:"relative",zIndex:1}}>© {new Date().getFullYear()} Aéro Service · Espace sécurisé</div>
    </section>
    <section className="login-form-side"><div className="login-card">
      <div className="brand" style={{padding:"0 0 30px"}}><div className="brand-mark" style={{background:"#ffffff",color:"#2474e5"}}><img src="/logo-aero-services.jpg" alt="Logo Aéro Service" /></div><div><div className="brand-name" style={{color:"#10243b"}}>AÉRO SERVICE</div><div className="brand-sub" style={{color:"#758396"}}>ESPACE DE CONNEXION</div></div></div>
      <h2>{mode === "login" ? "Bon retour parmi nous" : mode === "signup" ? "Créer un compte apprenant" : mode === "recovery" ? "Définir un nouveau mot de passe" : "Réinitialiser le mot de passe"}</h2><p>{mode === "login" ? "Connectez-vous pour accéder à votre espace de travail." : mode === "signup" ? "Inscrivez-vous à une formation Aéro Service. Votre dossier sera vérifié par le secrétariat." : mode === "recovery" ? "Saisissez votre nouveau mot de passe puis enregistrez-le pour terminer la récupération." : "Recevez un lien sécurisé par e-mail."}</p>
      {error && <div className="toast error-message">{error}</div>}{notice && <div className="toast">{notice}</div>}
      <form className="login-fields" onSubmit={mode === "login" ? handleLogin : mode === "signup" ? handleSignup : mode === "recovery" ? handlePasswordUpdate : handleReset}>
        {mode === "signup" && <><label className="field">Nom et prénom<input type="text" autoComplete="name" required value={signupName} onChange={e=>setSignupName(e.target.value)} placeholder="Ex. Aïcha Dossou"/></label><label className="field">Téléphone<input type="tel" autoComplete="tel" value={signupPhone} onChange={e=>setSignupPhone(e.target.value)} placeholder="Ex. 01 90 00 00 00"/></label><label className="field">Formation souhaitée<select required value={signupFormation} onChange={e=>setSignupFormation(e.target.value)}><option value="">{publicFormations.length ? "Choisir une formation" : "Aucune formation disponible pour le moment"}</option>{publicFormations.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label></>}
        {mode !== "recovery" && <label className="field">Adresse e-mail<input type="email" autoComplete="email" placeholder="vous@exemple.com" required value={email} onChange={e=>setEmail(e.target.value)} /></label>}
        {mode !== "reset" && <label className="field">{mode === "recovery" ? "Nouveau mot de passe" : "Mot de passe"}<input type="password" autoComplete={mode === "signup" || mode === "recovery" ? "new-password" : "current-password"} minLength={8} placeholder={mode === "recovery" ? "Choisissez un nouveau mot de passe" : "8 caractères minimum"} required value={password} onChange={e=>setPassword(e.target.value)} /></label>}
        <button className="btn btn-primary" style={{width:"100%",padding:13,marginTop:4}} disabled={busy}>{busy ? "Veuillez patienter…" : mode === "login" ? "Se connecter  →" : mode === "signup" ? "Créer mon compte et envoyer la demande" : mode === "recovery" ? "Enregistrer le nouveau mot de passe" : "Envoyer le lien"}</button>
      </form>
      <button className="link-btn" onClick={()=>{setMode(mode==="login"?"reset":"login");setError("");setNotice("");}}>{mode==="login"?"Mot de passe oublié ?":"← Retour à la connexion"}</button>
      {mode === "login" && <button className="link-btn" onClick={()=>{setMode("signup");setError("");setNotice("");setPassword("");}}>Créer un compte apprenant</button>}
      {mode === "signup" && <button className="link-btn" onClick={()=>{setMode("login");setError("");setNotice("");setPassword("");}}>← Retour à la connexion</button>}
      <div className="login-foot">La connexion est sécurisée par Supabase Auth.<br/>L’accès aux données dépend de votre rôle et des règles de sécurité.</div>
    </div></section>
  </main>;

  return <div className="app-shell">
    <aside className={"sidebar" + (mobileNav ? " mobile-open" : "")}>
      <div className="brand"><div className="brand-mark"><img src="/logo-aero-services.jpg" alt="Logo Aéro Service" /></div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Gestion & formation</div></div></div>
      {["PILOTAGE","PÉDAGOGIE","ORGANISATION","ADMINISTRATION","FINANCES","SYSTÈME"].map(section => visibleModules.some(m=>m.section===section) ? <div key={section}><div className="nav-label">{section}</div>{visibleModules.filter(m=>m.section===section).map(m=><button key={m.key} className={"nav-item"+(active===m.key?" active":"")} onClick={()=>{setActive(m.key);setSearch("");setShowCreate(false);setMobileNav(false);setNotice("");setError("");}}><span className="nav-icon">{m.icon}</span>{m.label}</button>)}</div> : null)}
      {isSecretary && <div><div className="nav-label">SUIVI DES PRÉSENCES</div><button className="nav-item" onClick={()=>{window.location.assign("/alertes-retard");setMobileNav(false);}}><span className="nav-icon">⚠</span>Alertes de retard</button></div>}
      <div className="sidebar-bottom"><div className="sidebar-note">Espace de travail sécurisé<br/>Aéro Service · Gestion intégrée</div></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div style={{display:"flex",alignItems:"center",gap:12}}><button className="btn mobile-menu" onClick={()=>setMobileNav(!mobileNav)}>☰</button><div><div className="breadcrumb">Aéro Service / {activeModule.label}</div><div className="topbar-title">{activeModule.label}</div></div></div><div className="top-actions"><button className="icon-btn" title="Actualiser" onClick={()=>{void loadCounts();if(active!=="dashboard"&&active!=="settings")void loadRows(active);}}>↻</button><div className="user-chip"><div className="avatar">{initials(fullName)}</div><div className="user-meta"><div className="user-name">{fullName}</div><div className="user-role">{roles.map(r=>r.name).join(" · ")||"Compte connecté"}</div></div></div><button className="btn" onClick={handleSignOut}>Déconnexion</button></div></header>
      <main className="content">
        {error && <div className="toast error-message">{error}</div>}{notice && <div className="toast">{notice}</div>}
        {active==="dashboard" && <>
          <div className="page-heading"><div><div className="eyebrow">ESPACE PERSONNEL · {roleLabel.toUpperCase()}</div><h1 className="page-title">Bonjour {fullName.split(" ")[0]} 👋</h1><p className="page-subtitle">{isAdmin ? "Vue globale de l’établissement et accès aux fonctions administratives." : isSecretary ? "Espace secrétariat : inscriptions, suivi des paiements et validation des accès apprenants." : isLearner ? "Votre espace apprenant personnel." : "Retrouvez les outils correspondant à votre fonction."}</p></div>{isAdmin && <button className="btn btn-primary" onClick={()=>{setActive("formations");setShowCreate(true);}}>＋ Nouvelle formation</button>}</div>
          {!isLearner && roleCodes.some(code => ["ACCOUNTING","FINANCE"].includes(code)) && <div className="stats-grid">
            {[{label:"Recettes aujourd’hui",value:financeTotals.today,icon:"₣",foot:"Paiements validés · FCFA"},{label:"Recettes du mois",value:financeTotals.month,icon:"▦",foot:"Depuis le 1er du mois · FCFA"},{label:"Recettes de l’année",value:financeTotals.year,icon:"↗",foot:"Depuis le 1er janvier · FCFA"},{label:"Paiements en attente",value:financeTotals.pending,icon:"◷",foot:"À contrôler / valider"}].map(item=><div className="stat-card" key={item.label}><div className="stat-top"><span>{item.label}</span><span className="stat-icon">{item.icon}</span></div><div className="stat-number">{item.value===null?"—":item.value.toLocaleString("fr-FR")}</div><div className="stat-foot">{item.foot}</div></div>)}
          </div>}
          {!isLearner && !roleCodes.some(code => ["ACCOUNTING","FINANCE"].includes(code)) && (isAdmin || isSecretary || roleCodes.some(code => ["PEDAGOGY","PEDAGOGIE"].includes(code))) && <div className="stats-grid">{metrics.map(metric=><div className="stat-card" key={metric.table}><div className="stat-top"><span>{metric.label}</span><span className="stat-icon">{metric.icon}</span></div><div className="stat-number">{counts[metric.table]===undefined?"…":counts[metric.table]===null?"—":counts[metric.table]}</div><div className="stat-foot">{metric.foot}</div></div>)}</div>}
          {!isLearner && <div className="panel"><div className="panel-head"><div><div className="panel-title">Accès rapide</div><div className="panel-desc">Retrouvez les espaces de travail les plus utilisés.</div></div></div><div className="panel-body"><div className="quick-grid">{[
            {key:"students" as ModuleKey,icon:"♙",title:"Gérer les apprenants",desc:"Consulter les dossiers et parcours"},
            {key:"formations" as ModuleKey,icon:"✈",title:"Catalogue des formations",desc:"Organiser l’offre pédagogique"},
            {key:"registrations" as ModuleKey,icon:"▣",title:"Suivre les inscriptions",desc:"Voir les demandes enregistrées"},
            {key:"attendance" as ModuleKey,icon:"◷",title:"Présences & pointage",desc:"Consulter les feuilles de présence"},
            {key:"payments" as ModuleKey,icon:"₣",title:"Suivi des paiements",desc:"Consulter les règlements"},
            {key:"roles" as ModuleKey,icon:"⚿",title:"Rôles & autorisations",desc:"Consulter les rôles configurés"}
          ].filter(q => canAccessModule(q.key, roleCodes)).map(q=><button className="quick-action" key={q.key} onClick={()=>{setActive(q.key);setSearch("");setError("");}}><span className="quick-icon">{q.icon}</span><span><div className="quick-title">{q.title}</div><div className="quick-desc">{q.desc}</div></span><span style={{marginLeft:"auto",color:"#9aa8b8"}}>→</span></button>)}</div></div></div>}
          {isLearner && <div className="panel"><div className="panel-head"><div><div className="panel-title">Votre espace apprenant</div><div className="panel-desc">Consultez vos cours et votre suivi personnel, sans accéder aux dossiers des autres apprenants.</div></div></div><div className="panel-body"><p style={{marginTop:0}}>Votre rôle actuel : <strong>Apprenant</strong>. Les fonctions de gestion et les dossiers des autres personnes restent protégés.</p><div className="form-actions"><button className="btn btn-primary" onClick={()=>{setActive("myCourses");setSearch("");setError("");}}>▤ Mes cours</button><button className="btn" onClick={()=>{setActive("myAttendance");setSearch("");setError("");}}>◷ Mes présences</button><button className="btn" onClick={()=>{setActive("myAbsences");setSearch("");setError("");}}>✎ Justifier une absence</button></div></div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Votre session</div><div className="panel-desc">Informations du compte actuellement connecté.</div></div><span className="pill active">● Connecté</span></div><div className="panel-body" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:20}}><div><div className="stat-foot">Adresse e-mail</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{user.email}</div></div><div><div className="stat-foot">Identifiant public</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{profile?.public_id||"Non renseigné"}</div></div><div><div className="stat-foot">Rôles attribués</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{roles.map(r=>r.name).join(", ")||"Aucun rôle chargé"}</div></div><div><div className="stat-foot">Statut du profil</div><div style={{marginTop:7}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"À vérifier"}</span></div></div></div></div>
        </>}
        {active!=="dashboard" && active!=="settings" && <>
          <div className="page-heading"><div><div className="eyebrow">{activeModule.section}</div><h1 className="page-title">{activeModule.label}</h1><p className="page-subtitle">{active === "attendance" ? "Enregistrez le retard, validez le montant payé et autorisez l’accès à l’apprenant." : active === "myAttendance" ? "Historique personnel du pointage quotidien. Les corrections restent réservées aux rôles autorisés." : activeModule.description}</p></div>{((["formations","students","registrations","groups","subjects","rooms"].includes(active)&&(isAdmin||(active==="registrations"&&canCreateStaffAccount)))||(active==="penalties"&&canManagePenalties)||(active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))))&&<button className="btn btn-primary" onClick={()=>setShowCreate(!showCreate)}>{showCreate?"Fermer":active==="formations"?"＋ Ajouter une formation":active==="students"?"＋ Ajouter un dossier":active==="registrations"?"＋ Nouvelle inscription":active==="groups"?"＋ Ajouter un groupe":active==="subjects"?"＋ Ajouter une matière":active==="payments"?"＋ Enregistrer un paiement":active==="penalties"?"＋ Nouvelle pénalité":"＋ Ajouter une salle"}</button>}</div>
          {active === "myAbsences" && isLearner && <div className="panel" style={{marginBottom:16}}><div className="panel-head"><div><div className="panel-title">Nouvelle justification d’absence</div><div className="panel-desc">Décrivez le motif. Votre demande sera privée et transmise pour examen.</div></div></div><div className="panel-body"><form onSubmit={async e=>{e.preventDefault();if(!user)return;setBusy(true);setError("");setNotice("");const {error:submitError}=await supabase.from("absence_justifications").insert({person_id:user.id,attendance_id:absenceForm.attendance_id||null,reason_type:absenceForm.reason_type,reason:absenceForm.reason.trim()||null,status:"pending"});if(submitError){setError("La justification n’a pas été envoyée : "+submitError.message);}else{setNotice("Justification envoyée. Vous pourrez suivre son statut dans la liste ci-dessous.");setAbsenceForm({attendance_id:"",reason_type:"illness",reason:""});await loadRows("myAbsences");}setBusy(false);}}><div className="form-grid"><label className="field">Absence concernée (facultatif)<select value={absenceForm.attendance_id} onChange={e=>setAbsenceForm({...absenceForm,attendance_id:e.target.value})}><option value="">Sélectionner une absence si elle est disponible</option>{myAbsenceRecords.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.local_date)} — Absence</option>)}</select></label><label className="field">Motif<select required value={absenceForm.reason_type} onChange={e=>setAbsenceForm({...absenceForm,reason_type:e.target.value})}><option value="illness">Maladie</option><option value="family">Obligation familiale</option><option value="transport">Problème de transport</option><option value="administrative">Démarche administrative</option><option value="other">Autre motif</option></select></label><label className="field" style={{gridColumn:"1 / -1"}}>Explication<textarea rows={3} value={absenceForm.reason} onChange={e=>setAbsenceForm({...absenceForm,reason:e.target.value})} placeholder="Précisez la date et les circonstances, sans informations médicales excessives."/></label></div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Envoi…":"Envoyer la justification"}</button></div></form></div></div>}{active === "penalties" && canManagePenalties && <div className="panel" style={{marginBottom:16}}><div className="panel-head"><div><div className="panel-title">Règles générales de pénalité</div><div className="panel-desc">Définissez une règle une seule fois pour les apprenants et le personnel. Créer une règle ne facture personne immédiatement.</div></div></div><div className="panel-body">{!ruleSchemaReady && <div className="notice notice-warning" role="status">La base utilisée par cette prévisualisation ne possède pas encore les colonnes des règles générales. La migration doit être appliquée à une base de test avant l’enregistrement.</div>}<form onSubmit={createPenaltyRule}><div className="form-grid"><label className="field">Motif<select required value={ruleForm.penalty_type} onChange={e=>setRuleForm({...ruleForm,penalty_type:e.target.value,application_mode:e.target.value==="late_arrival"?ruleForm.application_mode:"manual"})}><option value="late_arrival">Retard</option><option value="unjustified_absence">Absence injustifiée</option><option value="early_departure">Départ anticipé</option><option value="repeated_absence">Absences répétées</option><option value="noncompliance">Non-respect du règlement</option><option value="misconduct">Comportement inapproprié</option><option value="equipment_damage">Dégradation de matériel</option><option value="equipment_loss">Perte de matériel</option><option value="badge_loss">Perte de badge</option><option value="incomplete_file">Dossier incomplet</option><option value="late_payment">Retard de paiement</option><option value="unauthorized_access">Accès non autorisé</option><option value="safety_violation">Infraction à la sécurité</option><option value="exam_misconduct">Fraude ou incident d’examen</option><option value="other">Autre</option></select></label><label className="field">Personnes visées<select required value={ruleForm.target_scope} onChange={e=>setRuleForm({...ruleForm,target_scope:e.target.value})}><option value="all">Tout le monde (apprenants et personnel)</option><option value="students">Apprenants seulement</option><option value="staff">Personnel seulement</option><option value="teacher">Formateurs / enseignants seulement</option></select></label><label className="field">Mode d’application<select required value={ruleForm.application_mode} onChange={e=>setRuleForm({...ruleForm,application_mode:e.target.value})}><option value="automatic" disabled={ruleForm.penalty_type!=="late_arrival"}>Automatique lors du pointage (retards uniquement)</option><option value="manual">Manuel par l’administration</option></select></label><label className="field">Heure limite d’arrivée<input type="time" value={ruleForm.applies_after_time} onChange={e=>setRuleForm({...ruleForm,applies_after_time:e.target.value})}/></label><label className="field">Retard minimum (minutes)<input type="number" min="0" step="1" required value={ruleForm.min_delay_minutes} onChange={e=>setRuleForm({...ruleForm,min_delay_minutes:e.target.value})}/></label><label className="field">Tolérance (minutes)<input type="number" min="0" step="1" required value={ruleForm.tolerance_minutes} onChange={e=>setRuleForm({...ruleForm,tolerance_minutes:e.target.value})}/></label><label className="field">Montant (FCFA)<input type="number" min="1" step="1" required value={ruleForm.amount_fcfa} onChange={e=>setRuleForm({...ruleForm,amount_fcfa:e.target.value})}/></label><label className="field">Description / conditions<input value={ruleForm.description} onChange={e=>setRuleForm({...ruleForm,description:e.target.value})} placeholder="Ex. arrivée après 08 h 20"/></label></div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || !ruleSchemaReady}>{busy?"Enregistrement…":"Enregistrer la règle générale"}</button></div></form><div className="panel" style={{marginTop:18}}><div className="panel-head"><div><div className="panel-title">Appliquer une règle manuellement</div><div className="panel-desc">Crée une pénalité à régler pour une personne précise, sans encaisser ni valider le paiement.</div></div></div><div className="panel-body"><form onSubmit={applyPenaltyRule}><div className="form-grid"><label className="field">Règle active<select required value={applyRuleForm.rule_id} onChange={e=>setApplyRuleForm({...applyRuleForm,rule_id:e.target.value})}><option value="">Choisir une règle</option>{penaltyRules.filter(rule=>rule.active && rule.application_mode==="manual").map(rule=><option key={rule.id} value={rule.id}>{rule.penalty_type} — {Number(rule.amount_fcfa).toLocaleString("fr-FR")} FCFA{rule.description?" — "+rule.description:""}</option>)}</select></label><label className="field">Personne concernée<select required value={applyRuleForm.person_id} onChange={e=>setApplyRuleForm({...applyRuleForm,person_id:e.target.value})}><option value="">Choisir une personne</option>{profileOptions.filter(person=>{const rule=penaltyRules.find(item=>item.id===applyRuleForm.rule_id);if(!rule||rule.target_scope==="all")return true;if(rule.target_scope==="staff")return staffIds.includes(person.id);if(rule.target_scope==="teacher")return teacherIds.includes(person.id);if(rule.target_scope==="students")return studentIds.includes(person.id);return false;}).map(person=><option key={person.id} value={person.id}>{person.display_name||[person.first_name,person.last_name].filter(Boolean).join(" ")||person.public_id||person.id}</option>)}</select></label></div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || !ruleSchemaReady}>Attribuer la pénalité</button></div></form></div></div><div className="panel" style={{marginTop:18}}><div className="panel-head"><div><div className="panel-title">Règles enregistrées</div><div className="panel-desc">{penaltyRules.length} règle(s) chargée(s)</div></div></div><div className="panel-body">{penaltyRules.length===0?<p>Aucune règle générale disponible pour le moment.</p>:<div className="table-wrap"><table><thead><tr><th>Motif</th><th>Public</th><th>Mode</th><th>Heure limite</th><th>Montant</th><th>État</th></tr></thead><tbody>{penaltyRules.map(rule=><tr key={rule.id}><td>{rule.penalty_type||"Autre"}{rule.description?" — "+rule.description:""}</td><td>{rule.target_scope==="all"?"Tout le monde":rule.target_scope==="students"?"Apprenants":rule.target_scope==="staff"?"Personnel":"Enseignants"}</td><td>{rule.application_mode==="automatic"?"Automatique":"Manuel"}</td><td>{rule.applies_after_time||"Selon le retard"}</td><td>{Number(rule.amount_fcfa).toLocaleString("fr-FR")} FCFA</td><td>{rule.active?"Active":"Inactive"}</td></tr>)}</tbody></table></div>}</div></div></div></div>}{active === "attendance" && isSecretary && <div className="panel"><div className="panel-head"><div><div className="panel-title">Ouverture de la journée et pointage</div><div className="panel-desc">Fuseau horaire : Bénin (Africa/Porto-Novo). La borne est disponible à partir de 08 h 30 ; la première personne autorisée présente confirme l’ouverture. La Direction peut consulter sans devoir ouvrir elle-même.</div></div><span className={"pill " + (operatingDay?.status === "open" ? "active" : "pending")}>{operatingDay?.status === "open" ? "● Journée ouverte" : operatingDay?.status === "closed" ? "Journée clôturée" : "En attente d’ouverture"}</span></div><div className="panel-body"><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:18}}><div><div className="stat-foot">Date locale</div><strong>{String(operatingDay?.business_date || "—")}</strong></div><div><div className="stat-foot">Heure locale serveur</div><strong>{String(operatingDay?.local_time || "—")}</strong></div><div><div className="stat-foot">Ouverture enregistrée</div><strong>{operatingDay?.opened_at ? new Date(String(operatingDay.opened_at)).toLocaleString("fr-FR") : "Pas encore ouverte"}</strong></div><div><div className="stat-foot">Fermeture enregistrée</div><strong>{operatingDay?.closed_at ? new Date(String(operatingDay.closed_at)).toLocaleString("fr-FR") : "—"}</strong></div></div><div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={async()=>{setBusy(true);setError("");const {data,error:statusError}=await supabase.rpc("get_operating_day_status");if(statusError){setError("Impossible de lire l’état de la journée : "+statusError.message);}else setOperatingDay((data||null) as Record<string,any>|null);setBusy(false);}}>{busy?"Actualisation…":"Actualiser l’état"}</button><button type="button" className="btn btn-primary" disabled={busy || operatingDay?.status === "open"} onClick={async()=>{setBusy(true);setError("");setNotice("");const {data,error:operationError}=await supabase.rpc("operate_aero_service",{p_action:"open"});if(operationError){setError("Ouverture non confirmée : "+operationError.message);}else{setNotice("Ouverture de la journée enregistrée par le serveur.");const {data:latest,error:latestError}=await supabase.rpc("get_operating_day_status");if(latestError)setError(latestError.message);else setOperatingDay((latest||data||null) as Record<string,any>|null);}setBusy(false);}}>Ouvrir la journée</button><button type="button" className="btn" disabled={busy || operatingDay?.status !== "open"} onClick={async()=>{setBusy(true);setError("");setNotice("");const {data,error:operationError}=await supabase.rpc("operate_aero_service",{p_action:"close"});if(operationError){setError("Fermeture non confirmée : "+operationError.message);}else{setNotice("Fermeture de la journée enregistrée par le serveur.");const {data:latest,error:latestError}=await supabase.rpc("get_operating_day_status");if(latestError)setError(latestError.message);else setOperatingDay((latest||data||null) as Record<string,any>|null);}setBusy(false);}}>Clôturer la journée</button>{isAdmin && <button type="button" className="btn" disabled={busy} onClick={async()=>{setBusy(true);setError("");setNotice("");setNewKioskToken("");const {data,error:kioskError}=await supabase.rpc("activate_presence_kiosk",{p_name:"Borne principale"});if(kioskError)setError("Activation de la borne non confirmée : "+kioskError.message);else if(data?.device_token){setNewKioskToken(String(data.device_token));setNotice("Borne créée. Le jeton est affiché une seule fois : conservez-le pour préparer le QR.");}else setError("Le serveur n’a pas retourné le jeton de la borne.");setBusy(false);}}>Créer / renouveler le jeton de la borne</button>}</div>{newKioskToken && <div style={{marginTop:16,padding:14,border:"1px solid #d7e0ea",borderRadius:10}}><strong>Jeton de borne — affiché une seule fois</strong><p style={{overflowWrap:"anywhere",fontFamily:"monospace"}}>{newKioskToken}</p><p className="panel-desc">Lien à encoder en QR sur cet environnement : {typeof window !== "undefined" ? window.location.origin + "/pointage?token=" + encodeURIComponent(newKioskToken) : "/pointage?token=…"}</p><button type="button" className="btn" onClick={()=>{void navigator.clipboard.writeText(typeof window !== "undefined" ? window.location.origin + "/pointage?token=" + encodeURIComponent(newKioskToken) : "/pointage");setNotice("Lien de pointage copié.");}}>Copier le lien de pointage</button></div>}<p className="panel-desc" style={{marginTop:14}}>Le serveur conserve l’heure réelle d’ouverture et de fermeture. L’ouverture ne crée pas automatiquement une présence et ne valide aucun paiement.</p></div></div>}{active==="registrations"&&showCreate&&canCreateStaffAccount&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer un compte pour un nouvel arrivant</div><div className="panel-desc">Le secrétariat, la Direction et les administrateurs autorisés peuvent créer les identifiants. Les rôles privilégiés ne peuvent pas être attribués depuis ce formulaire.</div></div></div><div className="panel-body"><form onSubmit={createAccountForRegistration}><div className="form-grid"><label className="field">Nom et prénom<input required value={newAccount.display_name} onChange={e=>setNewAccount({...newAccount,display_name:e.target.value})} placeholder="Nom complet"/></label><label className="field">Adresse e-mail (identifiant)<input type="email" required value={newAccount.email} onChange={e=>setNewAccount({...newAccount,email:e.target.value})} placeholder="eleve@exemple.com"/></label><label className="field">Mot de passe initial<input type="password" required minLength={8} value={newAccount.password} onChange={e=>setNewAccount({...newAccount,password:e.target.value})} placeholder="8 caractères minimum"/></label><label className="field">Téléphone (facultatif)<input value={newAccount.phone} onChange={e=>setNewAccount({...newAccount,phone:e.target.value})} placeholder="Téléphone"/></label><label className="field">Formation souhaitée<select required={newAccount.role_code==="STUDENT"} value={newAccount.formation_id} onChange={e=>setNewAccount({...newAccount,formation_id:e.target.value})}><option value="">Choisir une formation</option>{formationOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><label className="field">Rôle à attribuer<select required value={newAccount.role_code} onChange={e=>setNewAccount({...newAccount,role_code:e.target.value})}><option value="STUDENT">Apprenant</option><option value="TEACHER">Enseignant</option><option value="STAFF">Personnel</option><option value="TRAVEL_AGENT">Agent de voyage</option><option value="ACCOUNTING">Comptabilité / Finance</option><option value="PEDAGOGY">Responsable pédagogique</option></select></label></div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Création du compte…":"Créer le compte et attribuer le rôle"}</button></div></form></div></div>}
          {active!=="formations"&&showCreate&&(isAdmin||(active==="registrations"&&isSecretary)||(active==="penalties"&&canManagePenalties)||(active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))))&&createFields[active]&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer un enregistrement</div><div className="panel-desc">{active==="payments"?"Le paiement sera créé en attente de validation. Aucun reçu ne sera émis avant validation.":active==="penalties"?"Cette création sert à enregistrer une pénalité individuelle exceptionnelle. Pour une règle générale, utilisez le panneau ci-dessus.":"Les données seront enregistrées dans la base existante, selon les autorisations Supabase."}</div></div></div><div className="panel-body"><form onSubmit={createModuleRecord}><div className="form-grid">{createFields[active].filter(field => active !== "payments" || (field.name === "penalty_id" ? createValues.payment_type === "penalty" : ["person_id","payer_name","payer_phone","payer_identifier","payment_description","payment_category","amount_fcfa"].includes(field.name) ? createValues.payment_type === "ordinary" : true)).map(field=><label className="field" key={field.name}>{field.label}{field.type==="formation"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une formation</option>{formationOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="group"?<select value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir un groupe</option>{groupOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="penalty"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">{penaltyOptions.length ? "Choisir une pénalité à régler" : "Aucune pénalité créée/en attente — créez-la d’abord dans le module Pénalités"}</option>{penaltyOptions.map(item=>{const person=profileOptions.find(p=>p.id===item.person_id);const name=person?.display_name||[person?.first_name,person?.last_name].filter(Boolean).join(" ")||person?.public_id||"Bénéficiaire";const labels:Record<string,string>={late_arrival:"Retard",unjustified_absence:"Absence injustifiée",early_departure:"Départ anticipé",repeated_absence:"Absences répétées",noncompliance:"Non-respect du règlement",misconduct:"Comportement inapproprié",equipment_damage:"Dégradation de matériel",equipment_loss:"Perte de matériel",badge_loss:"Perte de badge",incomplete_file:"Dossier incomplet",late_payment:"Retard de paiement",unauthorized_access:"Accès non autorisé",safety_violation:"Infraction aux règles de sécurité",exam_misconduct:"Fraude ou incident d’examen",other:"Autre pénalité"};const type=labels[item.penalty_type||""]||"Autre pénalité";return <option key={item.id} value={item.id}>{type} — {name} — {Number(item.amount_fcfa).toLocaleString("fr-FR")} FCFA{item.description?` — ${item.description}`:""} — ${item.id.slice(0,8).toUpperCase()}</option>;})}</select>:field.type==="penalty"?<select required={field.name==="penalty_id"&&(createValues.payment_type??"ordinary")==="penalty"} disabled={field.name==="penalty_id"&&(createValues.payment_type??"ordinary")!=="penalty"} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une pénalité encore en attente</option>{penaltyOptions.filter(item=>["pending","unpaid","due","open"].includes((item.status||"").toLowerCase())&&Number(item.amount_fcfa)>0).map(item=><option key={item.id} value={item.id}>{(profileOptions.find(p=>p.id===item.person_id)?.display_name||[profileOptions.find(p=>p.id===item.person_id)?.first_name,profileOptions.find(p=>p.id===item.person_id)?.last_name].filter(Boolean).join(" ")||profileOptions.find(p=>p.id===item.person_id)?.public_id||"Bénéficiaire")} — {Number(item.amount_fcfa).toLocaleString("fr-FR")} FCFA — {item.status}</option>)}</select>:field.type==="profile"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une personne</option>{profileOptions.map(item=><option key={item.id} value={item.id}>{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(" ")||item.public_id||item.id}</option>)}</select>:field.name==="payment_category"&&(createValues.payment_type??"ordinary")==="penalty"?<div className="field-static">Pénalité (catégorie définie automatiquement)</div>:field.type==="select"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value,...(field.name==="payment_type"?{penalty_id:"",payment_category:""}:{})})}><option value="">Choisir…</option>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input type={field.type??"text"} min={field.type==="number"?(active==="payments"?1:0):undefined} step={field.type==="number"&&active==="payments"?1:undefined} required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})} placeholder={field.type==="number"?"0":field.label}/>}</label>)}</div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":active==="payments"?"Enregistrer en attente de validation":active==="penalties"?"Créer la pénalité":"Enregistrer"}</button></div></form></div></div>}
          {active==="formations"&&showCreate&&isAdmin&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer une formation</div><div className="panel-desc">Les champs code et nom sont obligatoires.</div></div></div><div className="panel-body"><form onSubmit={createFormation}><div className="form-grid"><label className="field">Code de la formation<input required value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="Ex. PILOTAGE-01"/></label><label className="field">Nom de la formation<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex. Initiation au pilotage"/></label><label className="field">Durée<input value={form.duration} onChange={e=>setForm({...form,duration:e.target.value})} placeholder="Ex. 6 mois"/></label><label className="field">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Présentation de la formation"/></label></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":"Enregistrer la formation"}</button></div></form></div></div>}
          {active==="payments"&&receiptPayment&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Reçu de paiement généré</div><div className="panel-desc">Le paiement est validé et le reçu est disponible dans votre espace comptable.</div></div><button className="btn btn-primary" onClick={()=>printReceipt(receiptPayment)}>Imprimer / Enregistrer en PDF</button></div><div className="panel-body"><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14}}><div><div className="stat-foot">Numéro du reçu</div><strong>{String(receiptPayment.receipt_number||"En cours d’attribution")}</strong></div><div><div className="stat-foot">Payeur</div><strong>{String(receiptPayment.payer_name||profileOptions.find(p=>p.id===String(receiptPayment.person_id))?.display_name||[profileOptions.find(p=>p.id===String(receiptPayment.person_id))?.first_name,profileOptions.find(p=>p.id===String(receiptPayment.person_id))?.last_name].filter(Boolean).join(" ")||"Personne extérieure")}</strong></div><div><div className="stat-foot">Nature</div><strong>{String(receiptPayment.payment_category||"").replace(/_/g," ")}</strong></div><div><div className="stat-foot">Montant</div><strong>{Number(receiptPayment.amount_fcfa||0).toLocaleString("fr-FR")} FCFA</strong></div></div></div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">{activeModule.label} enregistrés</div><div className="panel-desc">Données affichées selon vos autorisations · maximum 100 lignes</div></div><div className="table-toolbar"><input className="search-box" placeholder="Rechercher dans les résultats…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn btn-quiet" onClick={()=>void loadRows(active)}>↻ Actualiser</button></div></div>
            {loading?<div className="loading">Chargement des données…</div>:filteredRows.length===0?<div className="empty-state"><div className="empty-icon">⌕</div><strong>{rows.length===0?"Aucune donnée à afficher":"Aucun résultat"}</strong><div style={{marginTop:7}}>{rows.length===0?"Ce module est vide ou les règles d’accès empêchent la lecture.":"Essayez avec un autre terme de recherche."}</div></div>:<div className="table-wrap"><table><thead><tr>{Object.keys(filteredRows[0]).filter(k=>k!=="id").map(k=><th key={k}>{k==="person_id"?"Compte lié":k==="payer_name"?"Payeur":k==="payment_category"?"Nature de recette":pretty(k)}</th>)}{active==="registrations"&&isSecretary&&<th>Actions</th>}{active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))&&<th>Actions</th>}</tr></thead><tbody>{filteredRows.map((row,i)=><tr className={String(row.status??"")==="regularized_late" ? "late-row" : undefined} key={String(row.id??row.code??i)}>{Object.entries(row).filter(([k])=>k!=="id").map(([k,v])=><td key={k}>{k==="person_id"? (profileOptions.find(p=>p.id===String(v))?.display_name || [profileOptions.find(p=>p.id===String(v))?.first_name,profileOptions.find(p=>p.id===String(v))?.last_name].filter(Boolean).join(" ") || String(v).slice(0,8)):k==="payment_category"?({"school_contribution":"Contribution scolaire","tuition":"Scolarité","registration_fee":"Frais d’inscription","training_fee":"Frais de formation","exam_fee":"Frais d’examen","document_sale":"Vente de documents","membership_fee":"Cotisation / adhésion","service_fee":"Prestation de service","equipment_fee":"Frais d’équipement","transport_fee":"Transport","penalty":"Pénalité","other":"Autre recette"} as Record<string,string>)[String(v)]||String(v):k==="status"&&v!=null?<span className={"pill "+statusClass(String(v))}>{pretty(String(v))}</span>:v==null?"—":typeof v==="boolean"?(v?"Oui":"Non"):typeof v==="object"?JSON.stringify(v):String(v).length>48?String(v).slice(0,45)+"…":String(v)}</td>)}{active==="registrations"&&isSecretary&&(String(row.status)==="pending"||String(row.status)==="approved")&&<td><button className="btn btn-primary" disabled={busy} onClick={()=>void reviewRegistration(row,"approved")}>{String(row.status)==="approved"?"Finaliser l’activation":"Valider"}</button> {String(row.status)==="pending"&&<button className="btn" disabled={busy} onClick={()=>void reviewRegistration(row,"rejected")}>Rejeter</button>}</td>}{active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))&&<td>{String(row.status??"").toLowerCase() === "pending"?<button className="btn btn-primary" disabled={busy} onClick={()=>void validatePayment(row)}>Valider et générer le reçu</button>:row.receipt_number?<button className="btn" onClick={()=>{setReceiptPayment(row);printReceipt(row)}}>Voir / imprimer reçu</button>:<span className="stat-foot">Aucune action</span>}</td>}</tr>)}</tbody></table></div>}
          </div>
        </>}
        {active==="settings"&&<><div className="page-heading"><div><div className="eyebrow">SYSTÈME</div><h1 className="page-title">Paramètres du compte</h1><p className="page-subtitle">Consultez les informations de votre session et la configuration de sécurité.</p></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Profil connecté</div></div><div className="panel-body" style={{display:"grid",gap:18}}><div><div className="stat-foot">Nom affiché</div><div style={{fontWeight:700,marginTop:5}}>{fullName}</div></div><div><div className="stat-foot">E-mail</div><div style={{fontWeight:700,marginTop:5}}>{user.email}</div></div><div><div className="stat-foot">Rôles</div><div style={{marginTop:5}}>{roles.map(r=><span className="pill" key={r.code} style={{marginRight:6}}>{r.name}</span>)}</div></div><div><div className="stat-foot">Statut</div><div style={{marginTop:5}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"Non renseigné"}</span></div></div><button className="btn" style={{justifySelf:"start"}} onClick={handleSignOut}>Se déconnecter de cette session</button></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Sécurité et données</div></div><div className="panel-body" style={{fontSize:12,color:"#758396",lineHeight:1.8}}>La connexion est gérée par Supabase Auth. Les données sont chargées via les politiques de sécurité (RLS) configurées sur la base. Aucun secret de serveur n’est embarqué dans cette interface.</div></div></>}
        <div style={{textAlign:"center",fontSize:10,color:"#9aa6b5",padding:"12px 0 0"}}>AÉRO SERVICE · Plateforme de gestion · {new Date().getFullYear()}</div>
      </main>
    </section>
  </div>;
}
