"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Profile = { id: string; public_id?: string | null; first_name?: string | null; last_name?: string | null; display_name?: string | null; email?: string | null; status?: string };
type Role = { code: string; name: string };
type ModuleKey = "dashboard" | "students" | "teachers" | "formations" | "groups" | "subjects" | "rooms" | "registrations" | "attendance" | "payments" | "staff" | "roles" | "settings";
type ModuleConfig = { key: ModuleKey; label: string; icon: string; table?: string; columns?: string[]; description: string; section: string };
const modules: ModuleConfig[] = [
  { key: "dashboard", label: "Vue d’ensemble", icon: "⌂", description: "Les indicateurs essentiels de votre établissement.", section: "PILOTAGE" },
  { key: "students", label: "Apprenants", icon: "♙", table: "students", columns: ["student_number", "formation_id", "group_id", "enrollment_date", "education_level"], description: "Suivi des apprenants et de leurs parcours.", section: "PÉDAGOGIE" },
  { key: "teachers", label: "Formateurs", icon: "♧", table: "teachers", columns: ["id", "teacher_number", "specialization", "hire_date", "status"], description: "Équipe pédagogique et affectations.", section: "PÉDAGOGIE" },
  { key: "formations", label: "Formations", icon: "✈", table: "formations", columns: ["code", "name", "duration", "status", "created_at"], description: "Catalogue des formations proposées.", section: "PÉDAGOGIE" },
  { key: "groups", label: "Groupes", icon: "▦", table: "groups", columns: ["code", "name", "academic_year", "capacity", "status"], description: "Organisation des groupes et promotions.", section: "PÉDAGOGIE" },
  { key: "subjects", label: "Matières", icon: "▤", table: "subjects", columns: ["code", "name", "formation_id", "status"], description: "Matières et unités d’enseignement.", section: "PÉDAGOGIE" },
  { key: "rooms", label: "Salles", icon: "⌂", table: "rooms", columns: ["code", "name", "capacity", "location_description", "status"], description: "Salles et espaces de formation.", section: "ORGANISATION" },
  { key: "registrations", label: "Inscriptions", icon: "▣", table: "registrations", columns: ["id", "registration_number", "person_id", "formation_id", "group_id", "registration_date", "status", "submitted_at", "review_comment"], description: "Demandes d’inscription et admissions.", section: "ADMINISTRATION" },
  { key: "attendance", label: "Présences", icon: "◷", table: "attendance", columns: ["person_id", "person_type", "status", "planned_at", "arrived_at", "delay_minutes", "access_blocked", "anomaly_reason"], description: "Pointage et suivi des présences.", section: "ADMINISTRATION" },
  { key: "payments", label: "Paiements", icon: "₣", table: "payments", columns: ["person_id", "amount_fcfa", "method", "provider", "transaction_reference", "status", "received_at", "receipt_number"], description: "Suivi des règlements et frais.", section: "FINANCES" },
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
const statusClass = (v: string) => ["active", "approved", "success", "validated", "present", "paid"].includes(v.toLowerCase()) ? "active" : ["pending", "submitted", "pre_review"].includes(v.toLowerCase()) ? "pending" : ["late", "regularized_late"].includes(v.toLowerCase()) ? "late" : ["suspended", "rejected", "inactive", "absent"].includes(v.toLowerCase()) ? "rejected" : "";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join("") || "AS";

const roleModules: Record<string, ModuleKey[]> = {
  DIRECTOR: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","payments","staff","roles","settings"],
  ADMIN: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","payments","staff","roles","settings"],
  PRE_ADMIN: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","payments","staff","roles","settings"],
  SECRETARY: ["dashboard","students","registrations","attendance","payments","settings"],
  SECRETARIAT: ["dashboard","students","registrations","attendance","payments","settings"],
  SECRETAIRE: ["dashboard","students","registrations","attendance","payments","settings"],
  "SECRÉTAIRE": ["dashboard","students","registrations","attendance","payments","settings"],
  PEDAGOGY: ["dashboard","students","teachers","formations","groups","subjects","attendance","settings"],
  PEDAGOGIE: ["dashboard","students","teachers","formations","groups","subjects","attendance","settings"],
  TEACHER: ["dashboard","groups","subjects","attendance","formations","settings"],
  ENSEIGNANT: ["dashboard","groups","subjects","attendance","formations","settings"],
  STAFF: ["dashboard","attendance","settings"],
  PERSONNEL: ["dashboard","attendance","settings"],
  ACCOUNTING: ["dashboard","payments","settings"],
  FINANCE: ["dashboard","payments","settings"],
  TRAVEL_AGENT: ["dashboard","formations","settings"],
  STUDENT: ["dashboard","settings"],
  APPRENANT: ["dashboard","settings"]
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
  const [mode, setMode] = useState<"login" | "reset" | "signup">("login");
  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupFormation, setSignupFormation] = useState("");
  const [publicFormations, setPublicFormations] = useState<{id:string;name:string;code:string}[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [financeTotals, setFinanceTotals] = useState<{today:number|null;month:number|null;year:number|null;pending:number|null;count:number|null}>({today:null,month:null,year:null,pending:null,count:null});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newAccount, setNewAccount] = useState({ display_name: "", email: "", password: "", phone: "", role_code: "STUDENT" });
  const [mobileNav, setMobileNav] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", duration: "", description: "" });
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [lateForm, setLateForm] = useState({ person_type: "student", person_id: "", planned_time: "08:00", arrived_time: "", amount_fcfa: "", method: "cash", provider: "", transaction_reference: "", reason: "" });
  const [staffIds, setStaffIds] = useState<string[]>([]);

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
    const result = await supabase.from(config.table).select(cols).limit(100);
    if (result.error) {
      setRows([]);
      setError("Impossible de charger ce module avec les autorisations actuelles. Vérifiez les politiques d’accès Supabase (RLS) pour votre rôle.");
    } else setRows((result.data ?? []) as unknown as Record<string, unknown>[]);
    setLoading(false);
  }, [roles]);

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setRoles([]); setCounts({}); setRows([]); return; }
    void loadIdentity(user);
    void loadCounts();
  }, [user, loadIdentity, loadCounts]);

  useEffect(() => {
    if (!user) return;
    if (!canAccessModule(active, roles.map(role => role.code))) {
      setActive("dashboard"); setRows([]); setShowCreate(false);
      setError("Le menu demandé n’est pas autorisé pour votre rôle. Vous avez été redirigé vers votre espace.");
      return;
    }
    if (active !== "dashboard" && active !== "settings") void loadRows(active);
  }, [user, active, roles, loadRows]);

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
    await supabase.auth.signOut();
    setNotice("Votre compte a été créé et votre demande envoyée au secrétariat. Votre dossier est en attente de validation. Si un e-mail de confirmation est demandé, veuillez d’abord confirmer votre adresse.");
    setMode("login"); setPassword(""); setSignupName(""); setSignupPhone(""); setSignupFormation("");
    setBusy(false);
  }
  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (resetError) setError(resetError.message); else setNotice("Si cette adresse est enregistrée, un lien de réinitialisation sera envoyé.");
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
    payments: [
      { name: "person_id", label: "Apprenant / bénéficiaire", type: "profile", required: true },
      { name: "amount_fcfa", label: "Montant reçu (FCFA)", type: "number", required: true },
      { name: "method", label: "Mode de paiement", type: "select", required: true, options: [{ label: "Espèces", value: "cash" }, { label: "Mobile Money", value: "mobile_money" }, { label: "Virement bancaire", value: "bank_transfer" }, { label: "Carte", value: "card" }, { label: "Autre", value: "other" }] },
      { name: "provider", label: "Opérateur / banque (facultatif)" },
      { name: "transaction_reference", label: "Référence de transaction (facultatif)" }
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
    ]
  };
  const [formationOptions, setFormationOptions] = useState<{ id: string; name: string; code: string }[]>([]);
  const [groupOptions, setGroupOptions] = useState<{ id: string; name: string; code: string }[]>([]);
  const [profileOptions, setProfileOptions] = useState<{ id: string; display_name: string | null; first_name: string | null; last_name: string | null; public_id: string | null }[]>([]);
  useEffect(() => {
    if (user && ["students", "groups", "subjects", "registrations"].includes(active)) {
      supabase.from("formations").select("id,name,code").order("name").then(({ data }) => setFormationOptions((data ?? []) as { id: string; name: string; code: string }[]));
    }
    if (user && ["students", "registrations", "attendance", "payments"].includes(active)) {
      supabase.from("groups").select("id,name,code").order("name").then(({ data }) => setGroupOptions((data ?? []) as { id: string; name: string; code: string }[]));
      supabase.from("profiles").select("id,display_name,first_name,last_name,public_id").order("last_name").limit(300).then(({ data }) => setProfileOptions((data ?? []) as { id: string; display_name: string | null; first_name: string | null; last_name: string | null; public_id: string | null }[]));
      supabase.from("staff").select("id").then(({ data }) => setStaffIds((data ?? []).map((item: { id: string }) => item.id)));
    }
  }, [user, active]);

  async function createAccountForRegistration(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isSecretary && !isAdmin) { setError("Vous n’êtes pas autorisé à créer un compte."); return; }
    setBusy(true); setError(""); setNotice("");
    const { data, error: accountError } = await supabase.functions.invoke("secretariat-create-account", {
      body: { display_name: newAccount.display_name.trim(), email: newAccount.email.trim(), password: newAccount.password, phone: newAccount.phone.trim(), role_code: newAccount.role_code }
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
      setCreateValues(current => ({ ...current, person_id: data.user_id, registration_date: current.registration_date || new Date().toISOString().slice(0, 10), status: current.status || "pending", registration_number: current.registration_number || ("AS-" + new Date().getFullYear() + "-" + data.user_id.replace(/-/g, "").slice(0, 8).toUpperCase()) }));
      setNotice("Compte apprenant créé. Ses identifiants sont prêts : notez l’adresse e-mail et le mot de passe saisis, puis terminez l’inscription ci-dessous.");
      setNewAccount({ display_name: "", email: "", password: "", phone: "", role_code: "STUDENT" });
    } else {
      setNotice("Compte créé et rôle attribué : " + data.role_code + ". L’utilisateur peut maintenant se connecter avec les identifiants créés.");
      setNewAccount({ display_name: "", email: "", password: "", phone: "", role_code: "STUDENT" });
    }
    setBusy(false);
  }

  async function createModuleRecord(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const canRecordPayment = roles.some(role => ["ACCOUNTING","FINANCE","SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","DIRECTOR","ADMIN","PRE_ADMIN"].includes(role.code.toUpperCase()));
    if (!(isAdmin || (isSecretary && active === "registrations") || (active === "payments" && canRecordPayment)) || !createFields[active]) return;
    setBusy(true); setError(""); setNotice("");
    const payload: Record<string, unknown> = {};
    for (const field of createFields[active]) {
      const value = (createValues[field.name] ?? "").trim();
      if (active === "students" && field.name === "id") payload.id = value;
      else if (field.type === "number") payload[field.name] = value ? Number(value) : null;
      else payload[field.name] = value || null;
    }
    if (active === "registrations") { payload.created_by = user?.id; payload.submitted_at = new Date().toISOString(); }
    if (active === "payments") { payload.status = "pending"; payload.received_by = user?.id; payload.receipt_number = null; }
    const { error: insertError } = await supabase.from(active).insert(payload);
    if (insertError) setError(insertError.message);
    else {
      setNotice("Enregistrement créé avec succès.");
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
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const plannedAt = new Date(`${day}T${lateForm.planned_time}:00`);
    const arrivedTime = lateForm.arrived_time || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const arrivedAt = new Date(`${day}T${arrivedTime}:00`);
    const delayMinutes = Math.max(0, Math.round((arrivedAt.getTime() - plannedAt.getTime()) / 60000));
    const amount = Math.round(Number(lateForm.amount_fcfa));
    const personLabel = lateForm.person_type === "staff" ? "Personnel" : "Apprenant";
    const note = `${personLabel} — retard ${delayMinutes} min. Montant payé : ${amount.toLocaleString("fr-FR")} FCFA. Accès autorisé par le secrétariat après validation du règlement.${lateForm.reason.trim() ? " Motif : " + lateForm.reason.trim() : ""}`;
    const attendanceResult = await supabase.from("attendance").insert({
      person_id: lateForm.person_id, person_type: lateForm.person_type,
      status: "late", planned_at: plannedAt.toISOString(), arrived_at: arrivedAt.toISOString(),
      delay_minutes: delayMinutes, access_blocked: true, source: "secretariat",
      anomaly: true, anomaly_reason: note
    }).select("id").single();
    if (attendanceResult.error || !attendanceResult.data) {
      setError(attendanceResult.error?.message || "Le retard n’a pas pu être enregistré.");
      setBusy(false); return;
    }
    const penaltyResult = await supabase.from("penalties").insert({
      attendance_id: attendanceResult.data.id, person_id: lateForm.person_id,
      amount_fcfa: amount, status: "paid"
    }).select("id").single();
    if (penaltyResult.error || !penaltyResult.data) {
      setError("Le retard est enregistré, mais le dossier de règlement n’a pas pu être créé. L’accès reste bloqué. Détail : " + (penaltyResult.error?.message || "erreur inconnue"));
      await loadRows("attendance"); setBusy(false); return;
    }
    const paymentResult = await supabase.from("payments").insert({
      penalty_id: penaltyResult.data.id, person_id: lateForm.person_id,
      amount_fcfa: amount, method: lateForm.method,
      provider: lateForm.provider.trim() || null,
      transaction_reference: lateForm.transaction_reference.trim() || null,
      status: "validated", received_at: arrivedAt.toISOString(), received_by: user.id,
      validated_at: new Date().toISOString(), validated_by: user.id
    });
    if (paymentResult.error) {
      await supabase.from("penalties").update({ status: "pending" }).eq("id", penaltyResult.data.id);
      setError("Le retard et le montant sont enregistrés, mais la validation du paiement a échoué. L’accès reste bloqué. Détail : " + paymentResult.error.message);
      await loadRows("attendance"); setBusy(false); return;
    }
    const accessResult = await supabase.from("attendance").update({
      status: "regularized_late", access_blocked: false,
      anomaly_reason: note + " Paiement validé. Accès autorisé."
    }).eq("id", attendanceResult.data.id);
    if (accessResult.error) {
      setError("Le paiement est validé, mais la mise à jour de l’autorisation d’accès a échoué. Prévenez l’administration. Détail : " + accessResult.error.message);
    } else {
      await supabase.from("attendance_events").insert({
        attendance_id: attendanceResult.data.id, person_id: lateForm.person_id,
        event_type: "regularized", occurred_at: new Date().toISOString(),
        source: "secretariat", created_by: user.id,
        metadata: { person_type: lateForm.person_type, delay_minutes: delayMinutes, amount_fcfa: amount, payment_method: lateForm.method, payment_status: "validated", authorized_by: user.id, access_authorized: true, reason: lateForm.reason.trim() || null }
      });
      setNotice(`Retard enregistré : ${delayMinutes} minute(s). Paiement de ${amount.toLocaleString("fr-FR")} FCFA validé. Accès autorisé — dossier affiché en jaune.`);
      setLateForm({ person_type: "student", person_id: "", planned_time: "08:00", arrived_time: "", amount_fcfa: "", method: "cash", provider: "", transaction_reference: "", reason: "" });
    }
    await loadRows("attendance"); await loadCounts(); setBusy(false);
  }

  async function reviewRegistration(registration: Record<string, unknown>, decision: "approved" | "rejected") {
    if (!user || !isSecretary) {
      setError("Vous n’avez pas l’autorisation de traiter cette inscription. Reconnectez-vous avec le compte du secrétariat.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const registrationId = String(registration.id ?? "");
    const personId = String(registration.person_id ?? "");
    if (!registrationId || !personId) {
      setError("Dossier incomplet : identifiant de demande ou de compte apprenant manquant.");
      setBusy(false);
      return;
    }
    const reviewComment = decision === "approved" ? "Dossier vérifié et approuvé par le secrétariat." : "Demande rejetée par le secrétariat. Veuillez contacter le secrétariat pour plus d’informations.";
    const { data: updatedRegistration, error: updateError } = await supabase.from("registrations")
      .update({ status: decision, reviewed_at: new Date().toISOString(), reviewed_by: user.id, review_comment: reviewComment })
      .eq("id", registrationId).select("id,status").maybeSingle();
    if (updateError || !updatedRegistration) {
      setError("La demande n’a pas été confirmée par la base de données. " + (updateError?.message || "Aucune ligne mise à jour : vérifiez les droits du secrétariat et le statut actuel."));
      setBusy(false);
      return;
    }
    if (decision === "approved") {
      const { data: updatedProfile, error: profileError } = await supabase.from("profiles")
        .update({ status: "active" }).eq("id", personId).select("id,status").maybeSingle();
      if (profileError || !updatedProfile) {
        setError("L’inscription est approuvée, mais le compte n’a pas été activé. " + (profileError?.message || "Le profil apprenant n’a pas été mis à jour. Vérifiez les droits du secrétariat dans Supabase."));
        await loadRows("registrations"); setBusy(false); return;
      }
      let secondaryIssue = "";
      const { data: existingStudent, error: lookupStudentError } = await supabase.from("students").select("id").eq("id", personId).maybeSingle();
      if (lookupStudentError) {
        secondaryIssue = "Compte activé, mais impossible de vérifier le dossier apprenant : " + lookupStudentError.message;
        setError(secondaryIssue);
      } else if (!existingStudent) {
        const studentNumber = "AS-" + new Date().getFullYear() + "-" + personId.replace(/-/g, "").slice(0, 8).toUpperCase();
        const { error: studentError } = await supabase.from("students").insert({ id: personId, student_number: studentNumber, formation_id: registration.formation_id || null, group_id: registration.group_id || null, enrollment_date: new Date().toISOString().slice(0,10) });
        if (studentError) { secondaryIssue = "Compte activé, mais le dossier apprenant n’a pas été créé automatiquement. " + studentError.message; setError(secondaryIssue); }
      }
      if (!updatedProfile || updatedProfile.status !== "active") {
        setError("La demande a été enregistrée, mais le statut actif du compte n’a pas été confirmé.");
      } else if (!secondaryIssue) {
        setNotice("VALIDATION CONFIRMÉE : inscription approuvée et compte apprenant activé. L’apprenant peut maintenant se connecter.");
      } else {
        setNotice("Inscription approuvée et compte activé. Attention : " + secondaryIssue);
      }
    } else {
      setNotice("Demande d’inscription rejetée et décision enregistrée.");
    }
    await loadRows("registrations"); await loadCounts(); setBusy(false);
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
  const isSecretary = roles.some(r => ["SECRETARY", "SECRETARIAT", "SECRETAIRE", "SECRÉTAIRE", "DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(r.code.toUpperCase()));
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

  if (!user) return <main className="login-screen">
    <section className="login-visual">
      <div className="brand"><div className="brand-mark">✈</div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Plateforme de gestion</div></div></div>
      <div className="login-visual-content"><div className="eyebrow" style={{color:"#9cc5ff"}}>FORMATION · ORGANISATION · SUIVI</div><h1>Prenez de la hauteur sur votre gestion.</h1><p>Un espace centralisé pour piloter les formations, suivre les apprenants et coordonner les opérations de votre établissement.</p><div className="login-bullets"><span>✦ Gestion pédagogique</span><span>✦ Suivi administratif</span><span>✦ Accès sécurisé</span></div></div>
      <div style={{fontSize:11,color:"#9db2c8",position:"relative",zIndex:1}}>© {new Date().getFullYear()} Aéro Service · Espace sécurisé</div>
    </section>
    <section className="login-form-side"><div className="login-card">
      <div className="brand" style={{padding:"0 0 30px"}}><div className="brand-mark" style={{background:"#eaf2ff",color:"#2474e5"}}>✈</div><div><div className="brand-name" style={{color:"#10243b"}}>AÉRO SERVICE</div><div className="brand-sub" style={{color:"#758396"}}>ESPACE DE CONNEXION</div></div></div>
      <h2>{mode === "login" ? "Bon retour parmi nous" : mode === "signup" ? "Créer un compte apprenant" : "Réinitialiser le mot de passe"}</h2><p>{mode === "login" ? "Connectez-vous pour accéder à votre espace de travail." : mode === "signup" ? "Inscrivez-vous à une formation Aéro Service. Votre dossier sera vérifié par le secrétariat." : "Recevez un lien sécurisé par e-mail."}</p>
      {error && <div className="toast error-message">{error}</div>}{notice && <div className="toast">{notice}</div>}
      <form className="login-fields" onSubmit={mode === "login" ? handleLogin : mode === "signup" ? handleSignup : handleReset}>
        {mode === "signup" && <><label className="field">Nom et prénom<input type="text" autoComplete="name" required value={signupName} onChange={e=>setSignupName(e.target.value)} placeholder="Ex. Aïcha Dossou"/></label><label className="field">Téléphone<input type="tel" autoComplete="tel" value={signupPhone} onChange={e=>setSignupPhone(e.target.value)} placeholder="Ex. 01 90 00 00 00"/></label><label className="field">Formation souhaitée<select required value={signupFormation} onChange={e=>setSignupFormation(e.target.value)}><option value="">{publicFormations.length ? "Choisir une formation" : "Aucune formation disponible pour le moment"}</option>{publicFormations.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label></>}
        <label className="field">Adresse e-mail<input type="email" autoComplete="email" placeholder="vous@exemple.com" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
        {mode !== "reset" && <label className="field">Mot de passe<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} placeholder="8 caractères minimum" required value={password} onChange={e=>setPassword(e.target.value)} /></label>}
        <button className="btn btn-primary" style={{width:"100%",padding:13,marginTop:4}} disabled={busy}>{busy ? "Veuillez patienter…" : mode === "login" ? "Se connecter  →" : mode === "signup" ? "Créer mon compte et envoyer la demande" : "Envoyer le lien"}</button>
      </form>
      <button className="link-btn" onClick={()=>{setMode(mode==="login"?"reset":"login");setError("");setNotice("");}}>{mode==="login"?"Mot de passe oublié ?":"← Retour à la connexion"}</button>
      {mode === "login" && <button className="link-btn" onClick={()=>{setMode("signup");setError("");setNotice("");setPassword("");}}>Créer un compte apprenant</button>}
      {mode === "signup" && <button className="link-btn" onClick={()=>{setMode("login");setError("");setNotice("");setPassword("");}}>← Retour à la connexion</button>}
      <div className="login-foot">La connexion est sécurisée par Supabase Auth.<br/>L’accès aux données dépend de votre rôle et des règles de sécurité.</div>
    </div></section>
  </main>;

  return <div className="app-shell">
    <aside className={"sidebar" + (mobileNav ? " mobile-open" : "")}>
      <div className="brand"><div className="brand-mark">✈</div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Gestion & formation</div></div></div>
      {["PILOTAGE","PÉDAGOGIE","ORGANISATION","ADMINISTRATION","FINANCES","SYSTÈME"].map(section => visibleModules.some(m=>m.section===section) ? <div key={section}><div className="nav-label">{section}</div>{visibleModules.filter(m=>m.section===section).map(m=><button key={m.key} className={"nav-item"+(active===m.key?" active":"")} onClick={()=>{setActive(m.key);setSearch("");setShowCreate(false);setMobileNav(false);setNotice("");setError("");}}><span className="nav-icon">{m.icon}</span>{m.label}</button>)}</div> : null)}
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
          {isLearner && <div className="panel"><div className="panel-head"><div><div className="panel-title">Votre espace apprenant</div><div className="panel-desc">Bienvenue dans votre espace personnel. Les informations pédagogiques et votre suivi doivent être consultés depuis les rubriques qui vous sont autorisées.</div></div></div><div className="panel-body">Votre rôle actuel : <strong>Apprenant</strong>. Les fonctions de gestion, les dossiers d’autres apprenants, le personnel et les paramètres administratifs ne sont pas accessibles depuis ce compte.</div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Votre session</div><div className="panel-desc">Informations du compte actuellement connecté.</div></div><span className="pill active">● Connecté</span></div><div className="panel-body" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:20}}><div><div className="stat-foot">Adresse e-mail</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{user.email}</div></div><div><div className="stat-foot">Identifiant public</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{profile?.public_id||"Non renseigné"}</div></div><div><div className="stat-foot">Rôles attribués</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{roles.map(r=>r.name).join(", ")||"Aucun rôle chargé"}</div></div><div><div className="stat-foot">Statut du profil</div><div style={{marginTop:7}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"À vérifier"}</span></div></div></div></div>
        </>}
        {active!=="dashboard" && active!=="settings" && <>
          <div className="page-heading"><div><div className="eyebrow">{activeModule.section}</div><h1 className="page-title">{activeModule.label}</h1><p className="page-subtitle">{active === "attendance" ? "Enregistrez le retard, validez le montant payé et autorisez l’accès à l’apprenant." : activeModule.description}</p></div>{((["formations","students","registrations","groups","subjects","rooms"].includes(active)&&(isAdmin||(active==="registrations"&&isSecretary)))||(active==="payments"&&roles.some(role=>["ACCOUNTING","FINANCE","SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","DIRECTOR","ADMIN","PRE_ADMIN"].includes(role.code.toUpperCase()))))&&<button className="btn btn-primary" onClick={()=>setShowCreate(!showCreate)}>{showCreate?"Fermer":active==="formations"?"＋ Ajouter une formation":active==="students"?"＋ Ajouter un dossier":active==="registrations"?"＋ Nouvelle inscription":active==="groups"?"＋ Ajouter un groupe":active==="subjects"?"＋ Ajouter une matière":active==="payments"?"＋ Enregistrer un paiement":"＋ Ajouter une salle"}</button>}</div>
          {active === "attendance" && isSecretary && <div className="panel late-panel"><div className="panel-head"><div><div className="panel-title">Retard et autorisation d’accès</div><div className="panel-desc">{isAdmin ? "Pour les apprenants et le personnel. Le DG et l’administration retrouvent les retards et paiements validés." : "Réservé aux apprenants : après validation du paiement, leur accès est autorisé. La secrétaire ne peut pas valider l’accès du personnel."}</div></div><span className="pill late-status">● Validation secrétaire</span></div><div className="panel-body"><form onSubmit={registerLateArrival}><div className="form-grid">{isAdmin && <label className="field">Catégorie<select required value={lateForm.person_type} onChange={e=>setLateForm({...lateForm,person_type:e.target.value,person_id:""})}><option value="student">Apprenant</option><option value="staff">Personnel</option></select></label>}<label className="field">{lateForm.person_type === "staff" ? "Membre du personnel" : "Apprenant"}<select required value={lateForm.person_id} onChange={e=>setLateForm({...lateForm,person_id:e.target.value})}><option value="">Rechercher / choisir une personne</option>{profileOptions.filter(item=>lateForm.person_type !== "staff" || staffIds.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.public_id ? item.public_id + " — " : ""}{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(" ")||item.id}</option>)}</select></label><label className="field">Heure normale d’arrivée<input type="time" required value={lateForm.planned_time} onChange={e=>setLateForm({...lateForm,planned_time:e.target.value})}/></label><label className="field">Heure d’arrivée constatée<input type="time" value={lateForm.arrived_time} onChange={e=>setLateForm({...lateForm,arrived_time:e.target.value})} /></label><label className="field">Montant payé (FCFA)<input type="number" min="1" step="1" required value={lateForm.amount_fcfa} onChange={e=>setLateForm({...lateForm,amount_fcfa:e.target.value})} placeholder="Ex. 1000"/></label><label className="field">Mode de paiement<select required value={lateForm.method} onChange={e=>setLateForm({...lateForm,method:e.target.value})}><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="other">Autre</option></select></label><label className="field">Opérateur (facultatif)<input value={lateForm.provider} onChange={e=>setLateForm({...lateForm,provider:e.target.value})} placeholder="Ex. MTN, Moov…"/></label><label className="field">Référence du paiement (facultatif)<input value={lateForm.transaction_reference} onChange={e=>setLateForm({...lateForm,transaction_reference:e.target.value})} placeholder="Référence ou numéro de reçu"/></label><label className="field">Motif / observation (facultatif)<input value={lateForm.reason} onChange={e=>setLateForm({...lateForm,reason:e.target.value})} placeholder="Ex. transport, circulation…"/></label></div><div className="late-preview"><span className="late-dot"></span><div><strong>Après validation réussie</strong><p>Le statut devient « Retard régularisé », la ligne apparaît en jaune et l’accès est autorisé. Le montant est conservé dans le suivi des paiements.</p></div></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setLateForm({person_type:"student",person_id:"",planned_time:"08:00",arrived_time:"",amount_fcfa:"",method:"cash",provider:"",transaction_reference:"",reason:""})}>Effacer</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Validation en cours…":"Valider le paiement et autoriser l’accès"}</button></div></form></div></div>}
          {active==="registrations"&&showCreate&&isSecretary&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer un compte pour un nouvel arrivant</div><div className="panel-desc">La secrétaire peut créer les identifiants et attribuer un rôle. Les rôles Direction et Pré-administrateur sont interdits ici.</div></div></div><div className="panel-body"><form onSubmit={createAccountForRegistration}><div className="form-grid"><label className="field">Nom et prénom<input required value={newAccount.display_name} onChange={e=>setNewAccount({...newAccount,display_name:e.target.value})} placeholder="Nom complet"/></label><label className="field">Adresse e-mail (identifiant)<input type="email" required value={newAccount.email} onChange={e=>setNewAccount({...newAccount,email:e.target.value})} placeholder="eleve@exemple.com"/></label><label className="field">Mot de passe initial<input type="password" required minLength={8} value={newAccount.password} onChange={e=>setNewAccount({...newAccount,password:e.target.value})} placeholder="8 caractères minimum"/></label><label className="field">Téléphone (facultatif)<input value={newAccount.phone} onChange={e=>setNewAccount({...newAccount,phone:e.target.value})} placeholder="Téléphone"/></label><label className="field">Rôle à attribuer<select required value={newAccount.role_code} onChange={e=>setNewAccount({...newAccount,role_code:e.target.value})}><option value="STUDENT">Apprenant</option><option value="TEACHER">Enseignant</option><option value="STAFF">Personnel</option><option value="TRAVEL_AGENT">Agent de voyage</option><option value="ACCOUNTING">Comptabilité / Finance</option><option value="PEDAGOGY">Responsable pédagogique</option></select></label></div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Création du compte…":"Créer le compte et attribuer le rôle"}</button></div></form></div></div>}
          {active!=="formations"&&showCreate&&(isAdmin||(active==="registrations"&&isSecretary)||(active==="payments"&&roles.some(role=>["ACCOUNTING","FINANCE","SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","DIRECTOR","ADMIN","PRE_ADMIN"].includes(role.code.toUpperCase()))))&&createFields[active]&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer un enregistrement</div><div className="panel-desc">{active==="payments"?"Le paiement sera créé en attente de validation. Aucun reçu ne sera émis avant validation.":"Les données seront enregistrées dans la base existante, selon les autorisations Supabase."}</div></div></div><div className="panel-body"><form onSubmit={createModuleRecord}><div className="form-grid">{createFields[active].map(field=><label className="field" key={field.name}>{field.label}{field.type==="formation"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une formation</option>{formationOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="group"?<select value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir un groupe</option>{groupOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="profile"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une personne</option>{profileOptions.map(item=><option key={item.id} value={item.id}>{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(" ")||item.public_id||item.id}</option>)}</select>:field.type==="select"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir…</option>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input type={field.type??"text"} min={field.type==="number"?0:undefined} required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})} placeholder={field.type==="number"?"0":field.label}/>}</label>)}</div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":active==="payments"?"Enregistrer en attente de validation":"Enregistrer"}</button></div></form></div></div>}
          {active==="formations"&&showCreate&&isAdmin&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer une formation</div><div className="panel-desc">Les champs code et nom sont obligatoires.</div></div></div><div className="panel-body"><form onSubmit={createFormation}><div className="form-grid"><label className="field">Code de la formation<input required value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="Ex. PILOTAGE-01"/></label><label className="field">Nom de la formation<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex. Initiation au pilotage"/></label><label className="field">Durée<input value={form.duration} onChange={e=>setForm({...form,duration:e.target.value})} placeholder="Ex. 6 mois"/></label><label className="field">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Présentation de la formation"/></label></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":"Enregistrer la formation"}</button></div></form></div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">{activeModule.label} enregistrés</div><div className="panel-desc">Données affichées selon vos autorisations · maximum 100 lignes</div></div><div className="table-toolbar"><input className="search-box" placeholder="Rechercher dans les résultats…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn btn-quiet" onClick={()=>void loadRows(active)}>↻ Actualiser</button></div></div>
            {loading?<div className="loading">Chargement des données…</div>:filteredRows.length===0?<div className="empty-state"><div className="empty-icon">⌕</div><strong>{rows.length===0?"Aucune donnée à afficher":"Aucun résultat"}</strong><div style={{marginTop:7}}>{rows.length===0?"Ce module est vide ou les règles d’accès empêchent la lecture.":"Essayez avec un autre terme de recherche."}</div></div>:<div className="table-wrap"><table><thead><tr>{Object.keys(filteredRows[0]).filter(k=>k!=="id").map(k=><th key={k}>{k==="person_id"?"Apprenant":pretty(k)}</th>)}{active==="registrations"&&isSecretary&&<th>Actions</th>}</tr></thead><tbody>{filteredRows.map((row,i)=><tr className={String(row.status??"")==="regularized_late" ? "late-row" : undefined} key={String(row.id??row.code??i)}>{Object.entries(row).filter(([k])=>k!=="id").map(([k,v])=><td key={k}>{k==="person_id"? (profileOptions.find(p=>p.id===String(v))?.display_name || [profileOptions.find(p=>p.id===String(v))?.first_name,profileOptions.find(p=>p.id===String(v))?.last_name].filter(Boolean).join(" ") || String(v).slice(0,8)):k==="status"&&v!=null?<span className={"pill "+statusClass(String(v))}>{pretty(String(v))}</span>:v==null?"—":typeof v==="boolean"?(v?"Oui":"Non"):typeof v==="object"?JSON.stringify(v):String(v).length>48?String(v).slice(0,45)+"…":String(v)}</td>)}{active==="registrations"&&isSecretary&&String(row.status)==="pending"&&<td><button className="btn btn-primary" disabled={busy} onClick={()=>void reviewRegistration(row,"approved")}>Valider</button> <button className="btn" disabled={busy} onClick={()=>void reviewRegistration(row,"rejected")}>Rejeter</button></td>}</tr>)}</tbody></table></div>}
          </div>
        </>}
        {active==="settings"&&<><div className="page-heading"><div><div className="eyebrow">SYSTÈME</div><h1 className="page-title">Paramètres du compte</h1><p className="page-subtitle">Consultez les informations de votre session et la configuration de sécurité.</p></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Profil connecté</div></div><div className="panel-body" style={{display:"grid",gap:18}}><div><div className="stat-foot">Nom affiché</div><div style={{fontWeight:700,marginTop:5}}>{fullName}</div></div><div><div className="stat-foot">E-mail</div><div style={{fontWeight:700,marginTop:5}}>{user.email}</div></div><div><div className="stat-foot">Rôles</div><div style={{marginTop:5}}>{roles.map(r=><span className="pill" key={r.code} style={{marginRight:6}}>{r.name}</span>)}</div></div><div><div className="stat-foot">Statut</div><div style={{marginTop:5}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"Non renseigné"}</span></div></div><button className="btn" style={{justifySelf:"start"}} onClick={handleSignOut}>Se déconnecter de cette session</button></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Sécurité et données</div></div><div className="panel-body" style={{fontSize:12,color:"#758396",lineHeight:1.8}}>La connexion est gérée par Supabase Auth. Les données sont chargées via les politiques de sécurité (RLS) configurées sur la base. Aucun secret de serveur n’est embarqué dans cette interface.</div></div></>}
        <div style={{textAlign:"center",fontSize:10,color:"#9aa6b5",padding:"12px 0 0"}}>AÉRO SERVICE · Plateforme de gestion · {new Date().getFullYear()}</div>
      </main>
    </section>
  </div>;
}
