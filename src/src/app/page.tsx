"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Profile = { id: string; public_id?: string | null; first_name?: string | null; last_name?: string | null; display_name?: string | null; email?: string | null; status?: string };
type AccountFormation = { id: string; code?: string | null; name?: string | null; status?: string | null };
type Role = { code: string; name: string };
type ModuleKey = "dashboard" | "students" | "teachers" | "formations" | "groups" | "subjects" | "rooms" | "registrations" | "attendance" | "justifications" | "penalties" | "payments" | "staff" | "roles" | "settings";
type ModuleConfig = { key: ModuleKey; label: string; icon: string; table?: string; columns?: string[]; description: string; section: string };
const modules: ModuleConfig[] = [
  { key: "dashboard", label: "Vue d’ensemble", icon: "⌂", description: "Les indicateurs essentiels de votre établissement.", section: "PILOTAGE" },
  { key: "students", label: "Apprenants", icon: "♙", table: "students", columns: ["first_name", "last_name", "display_name", "email", "student_number", "formation_id", "group_id", "enrollment_date", "education_level", "profile_status"], description: "Suivi des apprenants et de leurs parcours.", section: "PÉDAGOGIE" },
  { key: "teachers", label: "Formateurs", icon: "♧", table: "teachers", columns: ["id", "teacher_number", "specialization", "hire_date", "status"], description: "Équipe pédagogique et affectations.", section: "PÉDAGOGIE" },
  { key: "formations", label: "Formations", icon: "✈", table: "formations", columns: ["code", "name", "duration", "status", "created_at"], description: "Catalogue des formations proposées.", section: "PÉDAGOGIE" },
  { key: "groups", label: "Groupes", icon: "▦", table: "groups", columns: ["code", "name", "academic_year", "capacity", "status"], description: "Organisation des groupes et promotions.", section: "PÉDAGOGIE" },
  { key: "subjects", label: "Matières", icon: "▤", table: "subjects", columns: ["code", "name", "formation_id", "status"], description: "Matières et unités d’enseignement.", section: "PÉDAGOGIE" },
  { key: "rooms", label: "Salles", icon: "⌂", table: "rooms", columns: ["code", "name", "capacity", "location_description", "status"], description: "Salles et espaces de formation.", section: "ORGANISATION" },
  { key: "registrations", label: "Inscriptions", icon: "▣", table: "registrations", columns: ["id", "registration_number", "person_id", "formation_id", "group_id", "registration_date", "status", "submitted_at", "review_comment"], description: "Demandes d’inscription et admissions.", section: "ADMINISTRATION" },
  { key: "attendance", label: "Présences", icon: "◷", table: "attendance", columns: ["person_id", "person_type", "status", "planned_at", "arrived_at", "delay_minutes", "access_blocked", "anomaly_reason"], description: "Pointage et suivi des présences.", section: "ADMINISTRATION" },
  { key: "justifications", label: "Justifications d’absence", icon: "▤", table: "absence_justifications", columns: ["attendance_id", "person_id", "reason_type", "reason", "submitted_at", "status", "review_comment"], description: "Soumettre et examiner les justificatifs d’absence.", section: "ADMINISTRATION" },
  { key: "penalties", label: "Pénalités", icon: "⚠", table: "penalties", columns: ["id", "person_id", "penalty_type", "description", "amount_fcfa", "status", "created_at"], description: "Créer et suivre les pénalités, avec leur motif et leur montant.", section: "ADMINISTRATION" },
  { key: "payments", label: "Paiements", icon: "₣", table: "payments", columns: ["id", "payment_type", "payment_category", "penalty_id", "person_id", "payer_name", "payer_phone", "payer_identifier", "payment_description", "amount_fcfa", "method", "provider", "transaction_reference", "status", "received_at", "receipt_number"], description: "Paiements ordinaires et règlement des pénalités.", section: "FINANCES" },
  { key: "staff", label: "Personnel", icon: "♙", table: "staff", columns: ["first_name", "last_name", "display_name", "email", "role_code", "staff_number", "department", "position", "hire_date", "staff_status"], description: "Personnel administratif et opérationnel.", section: "ADMINISTRATION" },
  { key: "roles", label: "Rôles & accès", icon: "⚿", table: "roles", columns: ["id", "code", "name"], description: "Rôles disponibles dans la plateforme.", section: "SYSTÈME" },
  { key: "settings", label: "Paramètres", icon: "⚙", description: "Profil et préférences de session.", section: "SYSTÈME" }
];
const metrics = [
  { label: "Apprenants", table: "students", icon: "♙", foot: "Dossiers apprenants" },
  { label: "Formations", table: "formations", icon: "✈", foot: "Catalogue pédagogique" },
  { label: "Formateurs", table: "teachers", icon: "♧", foot: "Équipe pédagogique" },
  { label: "Inscriptions", table: "registrations", icon: "▣", foot: "Demandes enregistrées" }
];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const statusClass = (v: string) => ["active", "approved", "success", "validated", "present", "paid"].includes(v.toLowerCase()) ? "active" : ["pending", "submitted", "pre_review"].includes(v.toLowerCase()) ? "pending" : ["late", "regularized", "regularized_late"].includes(v.toLowerCase()) ? "late" : ["suspended", "rejected", "inactive", "absent"].includes(v.toLowerCase()) ? "rejected" : "";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join("") || "AS";
const escapeHtml = (value: unknown) => String(value ?? "—").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\x27/g,"&#39;");

const roleModules: Record<string, ModuleKey[]> = {
  DIRECTOR: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","penalties","payments","staff","roles","settings"],
  ADMIN: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","penalties","payments","staff","roles","settings"],
  PRE_ADMIN: ["dashboard","students","teachers","formations","groups","subjects","rooms","registrations","attendance","penalties","payments","staff","roles","settings"],
  SECRETARY: ["dashboard","students","registrations","attendance","justifications","penalties","payments","settings"],
  SECRETARIAT: ["dashboard","students","registrations","attendance","justifications","penalties","payments","settings"],
  SECRETAIRE: ["dashboard","students","registrations","attendance","justifications","penalties","payments","settings"],
  "SECRÉTAIRE": ["dashboard","students","registrations","attendance","justifications","penalties","payments","settings"],
  PEDAGOGY: ["dashboard","students","teachers","formations","groups","subjects","attendance","settings"],
  PEDAGOGIE: ["dashboard","students","teachers","formations","groups","subjects","attendance","settings"],
  TEACHER: ["dashboard","groups","subjects","attendance","formations","settings"],
  ENSEIGNANT: ["dashboard","groups","subjects","attendance","formations","settings"],
  STAFF: ["dashboard","attendance","settings"],
  PERSONNEL: ["dashboard","attendance","settings"],
  ACCOUNTING: ["dashboard","penalties","payments","settings"],
  FINANCE: ["dashboard","penalties","payments","settings"],
  TRAVEL_AGENT: ["dashboard","formations","settings"],
  STUDENT: ["dashboard","justifications","settings"],
  APPRENANT: ["dashboard","justifications","settings"]
};
const canAccessModule = (key: ModuleKey, roleCodes: string[]) => {
  const normalized = roleCodes.map(code => code.toUpperCase());
  if (normalized.some(code => ["DIRECTOR","ADMIN","PRE_ADMIN"].includes(code))) return true;
  return normalized.some(code => (roleModules[code] ?? ["dashboard","settings"]).includes(key));
};


export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accountFormation, setAccountFormation] = useState<AccountFormation | null>(null);
  const [studentNumber, setStudentNumber] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [identityReady, setIdentityReady] = useState(false);
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "reset" | "signup" | "new-password">("login");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [sendingWelcomeFor, setSendingWelcomeFor] = useState<string | null>(null);
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
  const [lateForm, setLateForm] = useState({ person_type: "student", person_id: "", planned_time: "08:00", arrived_time: "", amount_fcfa: "", method: "cash", provider: "", transaction_reference: "", reason: "" });
  const [absenceCandidates, setAbsenceCandidates] = useState<{id:string;session_id:string|null;planned_at:string|null;status:string}[]>([]);
  const [justificationForm, setJustificationForm] = useState({ attendance_id: "", reason_type: "medical", reason: "", document_url: "" });
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [penaltyRules, setPenaltyRules] = useState<Record<string, any>[]>([]);
  const [ruleSchemaReady, setRuleSchemaReady] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState({ formation_id: "", penalty_type: "late_arrival", description: "", target_scope: "students", application_mode: "automatic", applies_after_time: "", min_delay_minutes: "1", max_delay_minutes: "20", tolerance_minutes: "0", amount_fcfa: "1000" });
  const [applyRuleForm, setApplyRuleForm] = useState({ rule_id: "", person_id: "" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedModule = params.get("module");
    const personId = params.get("person_id") || "";
    const penaltyId = params.get("penalty_id") || "";
    if (requestedModule === "payments" && penaltyId) {
      setActive("payments");
      setShowCreate(true);
      setCreateValues({
        payment_type: "penalty",
        penalty_id: penaltyId,
        payment_category: "penalty",
        person_id: personId,
        amount_fcfa: params.get("amount_fcfa") || "",
        payment_description: "Règlement de pénalité après pointage QR"
      });
    } else if (requestedModule === "penalties") {
      setActive("penalties");
      setSearch(params.get("search") || "");
    }
  }, []);

  const loadIdentity = useCallback(async (current: User) => {
    // Secure server-side lookup avoids the profile/formation RLS read failure in the learner workspace.
    const { data: accountData, error: accountError } = await supabase.functions.invoke("my-account-status");
    if (!accountError && accountData) {
      setProfile((accountData.profile as Profile | null) ?? null);
      setRoles((accountData.roles ?? []) as Role[]);
      setAccountFormation((accountData.formation as AccountFormation | null) ?? null);
      setStudentNumber(typeof accountData.student_number === "string" ? accountData.student_number : null);
      setIdentityReady(true);
      return;
    }
    // Safe fallback for environments where the account-status function has not yet been deployed.
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from("profiles").select("id,public_id,first_name,last_name,display_name,email,status").eq("id", current.id).maybeSingle(),
      supabase.from("user_roles").select("roles(code,name)").eq("user_id", current.id)
    ]);
    setProfile((p as Profile | null) ?? null);
    const roleData = (r ?? []).flatMap((item: any) => Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []) as Role[];
    setRoles(roleData);
    setAccountFormation(null);
    setStudentNumber(null);
    setIdentityReady(true);
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
    if (key === "justifications" || key === "students" || key === "staff") {
      setLoading(true); setError("");
      const rpcName = key === "justifications" ? "list_absence_justifications" : key === "students" ? "list_students_directory" : "list_staff_directory";
      const { data, error: rpcError } = await supabase.rpc(rpcName);
      if (rpcError) {
        setRows([]);
        setError(key === "justifications"
          ? "Impossible de charger les justificatifs. Le workflow d’absence doit être installé sur la base TEST."
          : key === "students"
            ? "Impossible de charger les apprenants. Vérifiez les autorisations du répertoire et des profils sur TEST."
            : "Impossible de charger le personnel. Vérifiez les autorisations du répertoire et des profils sur TEST.");
      } else {
        setRows((data ?? []) as unknown as Record<string, unknown>[]);
      }
      setLoading(false); return;
    }
    const config = modules.find(m => m.key === key);
    if (!config?.table) { setRows([]); return; }
    setLoading(true); setError("");
    const cols = config.columns?.join(",") || "*";
    let result = await supabase.from(config.table).select(cols).limit(100);
    // TEST currently stores QR-created attendance in daily_attendance; production uses attendance.
    // Try the TEST table when the production-shaped table is unavailable OR empty,
    // otherwise the UI can misleadingly show "Aucune donnée" while TEST rows exist.
    if (key === "attendance" && (result.error || !(result.data?.length))) {
      const fallback = await supabase.from("daily_attendance").select("*").limit(100);
      if (!fallback.error) {
        const mapped = (fallback.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          planned_at: row.nominal_time ?? null,
          delay_minutes: row.minutes_after_cutoff ?? 0,
          access_blocked: row.status === "late" || row.status === "absent",
          anomaly_reason: row.status === "late" ? "Retard à régulariser" : row.status === "absent" ? "Absence à régulariser" : null,
          penalty_id: null,
          penalty_amount_fcfa: null,
          penalty_status: null
        }));
        setRows(mapped);
        setLoading(false);
        return;
      }
      if (result.error && fallback.error) {
        setRows([]);
        setError("Impossible de lire les pointages. Vérifiez les autorisations de lecture dans Supabase.");
        setLoading(false);
        return;
      }
    }
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
    const params = new URLSearchParams(window.location.search);
    if (params.get("recovery") === "1") setMode("new-password");
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { setMode("new-password"); setPassword(""); setPasswordConfirmation(""); setError(""); setNotice("Choisissez votre nouveau mot de passe."); }
      setUser(session?.user ?? null);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    setIdentityReady(false);
    if (!user) { setProfile(null); setRoles([]); setAccountFormation(null); setStudentNumber(null); setCounts({}); setRows([]); return; }
    void loadIdentity(user);
    void loadCounts();
  }, [user, loadIdentity, loadCounts]);

  useEffect(() => {
    if (!user || active !== "justifications") return;
    supabase.rpc("list_my_absence_candidates").then(({data,error}) => {
      setAbsenceCandidates(error ? [] : (data ?? []) as {id:string;session_id:string|null;planned_at:string|null;status:string}[]);
    });
  }, [user, active]);

  useEffect(() => {
    if (!user || !identityReady) return;
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
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/?recovery=1` });
    if (resetError) setError(resetError.message); else setNotice("Si cette adresse est enregistrée, un lien de réinitialisation sera envoyé.");
    setBusy(false);
  }
  async function handleUpdatePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    if (password.length < 8) { setError("Le nouveau mot de passe doit contenir au moins 8 caractères."); setBusy(false); return; }
    if (password !== passwordConfirmation) { setError("Les deux mots de passe ne correspondent pas."); setBusy(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setError("Le nouveau mot de passe n’a pas été enregistré : " + updateError.message); setBusy(false); return; }
    await supabase.auth.signOut();
    setUser(null); setMode("login"); setPassword(""); setPasswordConfirmation("");
    setNotice("Mot de passe modifié avec succès. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.");
    window.history.replaceState({}, document.title, window.location.pathname);
    setBusy(false);
  }

  async function sendWelcomeEmail(registration: Record<string, unknown>) {
    const personId = String(registration.person_id ?? "");
    if (!personId) {
      setError("Impossible d’envoyer le lien : identifiant du compte apprenant manquant.");
      return;
    }

    setSendingWelcomeFor(personId);
    setError("");
    setNotice("");

    try {
      // Read the existing learner account; do not create or modify an account.
      const { data: learner, error: learnerError } = await supabase
        .from("profiles")
        .select("email,status")
        .eq("id", personId)
        .maybeSingle();

      if (learnerError) throw new Error("Impossible de vérifier le compte apprenant : " + learnerError.message);
      if (!learner) throw new Error("Le profil de cet apprenant est introuvable.");
      if (String(learner.status ?? "").toLowerCase() !== "active") {
        throw new Error("Le compte doit être actif avant l’envoi du lien de connexion.");
      }
      if (typeof learner.email !== "string" || !learner.email.trim()) {
        throw new Error("Aucune adresse e-mail n’est enregistrée pour cet apprenant.");
      }

      // Use Supabase Auth's tested Magic Link flow and always return to the production app.
      const { error: magicLinkError } = await supabase.auth.signInWithOtp({
        email: learner.email.trim(),
        options: {
          emailRedirectTo: "https://aero-service.vercel.app/",
          shouldCreateUser: false,
        },
      });
      if (magicLinkError) throw new Error(magicLinkError.message);

      setNotice("Lien de connexion envoyé à l’adresse e-mail de l’apprenant. Le lien ouvre Aéro Service. Le compte existant n’a pas été modifié.");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Envoi non confirmé.";
      setError("Le lien de connexion n’a pas été envoyé. " + detail);
    } finally {
      setSendingWelcomeFor(null);
    }
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
      { name: "payment_category", label: "Nature de la recette", type: "select", required: true, options: [{ label: "Contribution scolaire", value: "school_contribution" }, { label: "Scolarité", value: "tuition" }, { label: "Frais d’inscription", value: "registration_fee" }, { label: "Frais de formation", value: "training_fee" }, { label: "Frais d’examen", value: "exam_fee" }, { label: "Vente de documents", value: "document_sale" }, { label: "Cotisation / adhésion", value: "membership_fee" }, { label: "Prestation de service", value: "service_fee" }, { label: "Frais d’équipement", value: "equipment_fee" }, { label: "Transport", value: "transport_fee" }, { label: "Pénalité", value: "penalty" }, { label: "Autre recette", value: "other" }] },
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
    if (user && ["students", "groups", "subjects", "registrations", "penalties"].includes(active)) {
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
        supabase.from("penalty_rules").select("id,formation_id,person_type,min_delay_minutes,max_delay_minutes,amount_fcfa,tolerance_minutes,blocks_access,priority,active,effective_from,effective_until,created_by,created_at,penalty_type,description,target_scope,application_mode,applies_after_time").order("priority", { ascending: true }).then(({ data, error }) => {
          setRuleSchemaReady(!error);
          setPenaltyRules(error ? [] : (data ?? []) as Record<string, any>[]);
        });
      } else { setPenaltyRules([]); setRuleSchemaReady(true); }
    }
  }, [user, active]);

  async function createPenaltyRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const allowed = roles.some(role => ["DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()));
    if (!allowed || !user) { setError("Seule la Direction ou le pré-administrateur peut créer ou modifier une règle générale."); return; }
    if (ruleForm.application_mode === "automatic" && ruleForm.penalty_type !== "late_arrival") { setError("Pour le moment, l’application automatique est disponible pour les retards enregistrés au pointage. Utilisez le mode manuel pour les autres motifs."); return; }
    const amount = Number(ruleForm.amount_fcfa), minDelay = Number(ruleForm.min_delay_minutes), tolerance = Number(ruleForm.tolerance_minutes);
    const maxDelay = ruleForm.max_delay_minutes.trim() === "" ? null : Number(ruleForm.max_delay_minutes);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(minDelay) || minDelay < (ruleForm.penalty_type === "late_arrival" ? 1 : 0) || !Number.isSafeInteger(tolerance) || tolerance < 0 ||
        (maxDelay !== null && (!Number.isSafeInteger(maxDelay) || maxDelay < minDelay))) {
      setError("Vérifiez le montant, la plage de retard et la tolérance. Pour un retard, la première minute facturable est 1.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const legacyPersonType = ruleForm.target_scope === "all" ? "student" : ruleForm.target_scope === "students" ? "student" : ruleForm.target_scope;
    const existingRule = editingRuleId ? penaltyRules.find(item => item.id === editingRuleId) : null;
    const payload = {
      person_type: legacyPersonType, formation_id: ruleForm.formation_id || null, penalty_type: ruleForm.penalty_type, description: ruleForm.description.trim() || null,
      target_scope: ruleForm.target_scope, application_mode: ruleForm.application_mode, applies_after_time: ruleForm.applies_after_time || null,
      min_delay_minutes: minDelay, max_delay_minutes: maxDelay, tolerance_minutes: tolerance, amount_fcfa: amount,
      blocks_access: existingRule?.blocks_access ?? false, priority: existingRule?.priority ?? 100, active: existingRule?.active ?? true,
      effective_from: existingRule?.effective_from || new Date().toISOString(), created_by: user.id
    };
    const saveResult = editingRuleId
      ? await supabase.from("penalty_rules").update(payload).eq("id", editingRuleId).select("id").single()
      : await supabase.from("penalty_rules").insert(payload).select("id").single();
    if (saveResult.error || !saveResult.data) setError(saveResult.error?.message || "La règle n’a pas pu être enregistrée. Vérifiez la migration des règles générales.");
    else {
      setNotice(editingRuleId ? "Règle de pénalité mise à jour." : "Règle générale enregistrée. " + (ruleForm.application_mode === "automatic" ? "Les prochaines présences correspondantes pourront générer une pénalité automatiquement." : "Elle est prête à être appliquée manuellement."));
      setEditingRuleId(null);
      setRuleForm({ ...ruleForm, description: "" });
      const refreshed = await supabase.from("penalty_rules").select("id,formation_id,person_type,min_delay_minutes,max_delay_minutes,amount_fcfa,tolerance_minutes,blocks_access,priority,active,effective_from,effective_until,created_by,created_at,penalty_type,description,target_scope,application_mode,applies_after_time").order("priority", { ascending: true });
      if (!refreshed.error) setPenaltyRules((refreshed.data ?? []) as Record<string, any>[]);
      await loadRows("penalties");
    }
    setBusy(false);
  }

  async function applyPenaltyRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Match the current Supabase RLS policy for penalties; ADMIN alone is not granted this write policy.
    const allowed = roles.some(role => ["DIRECTOR","PRE_ADMIN","SECRETARIAT"].includes(role.code.toUpperCase()));
    if (!allowed || !user) { setError("Votre rôle ne permet pas d’appliquer une règle de pénalité."); return; }
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
    try {
      // Refresh the authenticated session before calling the protected Edge Function.
      // This avoids stale/expired access tokens causing the generic non-2xx error.
      let { data: sessionData } = await supabase.auth.getSession();
      let session = sessionData.session;
      if (session?.refresh_token) {
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error && refreshed.data.session) session = refreshed.data.session;
      }
      if (!session?.access_token) {
        setError("Votre session a expiré. Reconnectez-vous, puis recommencez l’inscription.");
        return;
      }
      const requestedRole = newAccount.role_code;
      const { data, error: accountError } = await supabase.functions.invoke("secretariat-create-account", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { display_name: newAccount.display_name.trim(), email: newAccount.email.trim(), password: newAccount.password, phone: newAccount.phone.trim(), role_code: requestedRole, formation_id: newAccount.formation_id || undefined }
      });
      if (accountError || data?.error || !data?.user_id) {
        // Supabase wraps non-2xx Edge Function responses in a generic error.
        // Read the JSON body so the secretary sees the real reason, in French.
        let serverError: Record<string, unknown> = {};
        const context = (accountError as any)?.context;
        if (context && typeof context.json === "function") {
          try { serverError = await context.json(); } catch { /* response body unavailable */ }
        }
        const rawError = String(data?.error || serverError.error || accountError?.message || "");
        const detail = data?.detail || serverError.detail;
        const rawMessage = String(detail ? `${rawError} — ${detail}` : rawError);
        const normalized = rawMessage.toLowerCase();
        let message = rawMessage || "Impossible de créer le compte.";
        if (normalized.includes("email_exists") || normalized.includes("already been registered") || normalized.includes("already registered")) {
          message = "Cette adresse e-mail possède déjà un compte Aéro Service. Utilisez une autre adresse, ou recherchez l’apprenant dans la liste avant de recommencer.";
        } else if (normalized.includes("formation_required")) {
          message = "Choisissez une formation pour ce compte apprenant.";
        } else if (normalized.includes("formation_not_available")) {
          message = "La formation choisie n’est plus active. Actualisez la page et sélectionnez une formation disponible.";
        } else if (normalized.includes("invalid_account_details")) {
          message = "Vérifiez le nom, l’adresse e-mail et le mot de passe (8 caractères minimum).";
        } else if (normalized.includes("auth_required") || normalized.includes("401")) {
          message = "Votre session a expiré ou n’est plus valide. Reconnectez-vous puis recommencez l’inscription.";
        } else if (normalized.includes("role_not_allowed")) {
          message = "Le rôle sélectionné n’est pas autorisé pour cette création de compte.";
        } else if (normalized.includes("profile_create_failed") || normalized.includes("role_assignment_failed") || normalized.includes("registration_save_failed") || normalized.includes("student_record_create_failed")) {
          message = "Le compte n’a pas pu être finalisé dans la base TEST. Détail technique : " + rawMessage;
        }
        setError(message);
        return;
      }
      const parts = newAccount.display_name.trim().split(/\\s+/);
      const createdProfile = { id: data.user_id, display_name: newAccount.display_name.trim(), first_name: parts.slice(0, -1).join(" ") || newAccount.display_name.trim(), last_name: parts.length > 1 ? parts[parts.length - 1] : "", public_id: null };
      setProfileOptions(current => [createdProfile, ...current.filter(item => item.id !== data.user_id)]);
      if (requestedRole === "STUDENT") {
        // The Edge Function already creates the profile as active, assigns STUDENT,
        // writes an approved registration and creates the student record atomically.
        // Do not seed a second, pending registration form for this same person.
        setNotice("INSCRIPTION VALIDÉE : profil actif et approuvé, formation attribuée, compte prêt pour la borne QR. Aucune approbation supplémentaire n’est nécessaire. Notez les identifiants remis à l’apprenant.");
        await Promise.all([loadRows("registrations"), loadRows("students"), loadCounts()]);
      } else {
        setNotice("Compte créé et rôle attribué : " + requestedRole + ". L’utilisateur peut maintenant se connecter avec les identifiants créés.");
      }
      setNewAccount({ display_name: "", email: "", password: "", phone: "", role_code: "STUDENT", formation_id: "" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Une erreur inattendue empêche la création du compte.");
    } finally {
      setBusy(false);
    }
  }
  async function createModuleRecord(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const canRecordPayment = roles.some(role => ["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()));
    const canCreatePenalty = roles.some(role => ["SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","DIRECTOR","PRE_ADMIN","ADMIN"].includes(role.code.toUpperCase()));
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
    if (insertError) setError(insertError.message);
    else {
      setNotice(active === "payments" ? "Paiement enregistré en attente de validation. Aucun reçu n’a été émis." : "Enregistrement créé avec succès.");
      setCreateValues({}); setShowCreate(false);
      await loadRows(active); await loadCounts();
    }
    setBusy(false);
  }

  async function openAttendancePenalty(row: Record<string, unknown>) {
    const allowed = roles.some(role => ["DIRECTOR", "PRE_ADMIN", "SECRETARIAT", "SECRETARY", "SECRETAIRE", "SECRÉTAIRE"].includes(role.code.toUpperCase()));
    if (!user || !allowed) { setError("Votre rôle ne permet pas de gérer la régularisation des retards."); return; }
    if (String(row.status ?? "").toLowerCase() !== "late") { setError("Cette ligne n’est pas un retard à régulariser."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      let penaltyId = typeof row.penalty_id === "string" ? row.penalty_id : "";
      if (!penaltyId) {
        const personId = String(row.person_id ?? "");
        const attendanceId = String(row.id ?? "");
        const delay = Number(row.delay_minutes ?? row.minutes_after_cutoff ?? 0);
        if (!personId || !attendanceId || delay <= 0) throw new Error("Le pointage ne contient pas les informations nécessaires pour créer la pénalité.");
        const { data: student } = await supabase.from("students").select("formation_id").eq("id", personId).maybeSingle();
        const { data: rules, error: rulesError } = await supabase.from("penalty_rules")
          .select("id,formation_id,min_delay_minutes,max_delay_minutes,tolerance_minutes,amount_fcfa,description,active,application_mode,person_type,penalty_type,priority")
          .eq("active", true).eq("application_mode", "automatic").eq("person_type", "student")
          .eq("penalty_type", "late_arrival").order("priority", { ascending: true });
        if (rulesError) throw new Error("Impossible de lire le barème de retard : " + rulesError.message);
        const matching = (rules ?? []).filter((rule: any) =>
          (!rule.formation_id || rule.formation_id === student?.formation_id) &&
          delay > Number(rule.tolerance_minutes ?? 0) &&
          delay >= Number(rule.min_delay_minutes ?? 0) &&
          (rule.max_delay_minutes == null || delay <= Number(rule.max_delay_minutes))
        );
        const rule = matching[0];
        if (!rule) throw new Error("Aucune règle automatique active ne correspond à ce retard et à cette formation. Vérifiez le barème dans Pénalités.");
        const { data: created, error: createError } = await supabase.from("penalties").insert({
          person_id: personId, daily_attendance_id: attendanceId, rule_id: rule.id,
          amount_fcfa: Number(rule.amount_fcfa), status: "pending", penalty_type: "late_arrival",
          description: (rule.description || "Pénalité de retard") + " — retard constaté : " + delay + " minute(s)"
        }).select("id").single();
        if (createError || !created) throw new Error("La pénalité n’a pas pu être créée : " + (createError?.message || "aucune ligne retournée"));
        penaltyId = created.id;
        setNotice("Pénalité créée selon le barème : " + Number(rule.amount_fcfa).toLocaleString("fr-FR") + " FCFA. Ouverture du règlement…");
      }
      window.location.href = "/?module=payments&penalty_id=" + encodeURIComponent(penaltyId);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Impossible d’ouvrir la régularisation.");
      setBusy(false);
      await loadRows("attendance");
    }
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
    const automaticPenalty = await supabase.from("penalties").select("id,amount_fcfa,status").eq("attendance_id", attendanceResult.data.id).maybeSingle();
    if (automaticPenalty.error) {
      setError("Le pointage est enregistré, mais la pénalité automatique n’a pas pu être vérifiée. Aucun accès n’est autorisé. Détail : " + automaticPenalty.error.message);
      await loadRows("attendance"); setBusy(false); return;
    }
    let penaltyId = automaticPenalty.data?.id as string | undefined;
    let paymentAmount = automaticPenalty.data ? Number(automaticPenalty.data.amount_fcfa) : amount;
    if (automaticPenalty.data && paymentAmount !== amount) {
      setError("Le pointage a créé une pénalité de " + paymentAmount.toLocaleString("fr-FR") + " FCFA selon la règle générale. Le montant saisi ne correspond pas : la pénalité reste à régler dans Comptabilité / Paiements.");
      await loadRows("attendance"); await loadRows("penalties"); setBusy(false); return;
    }
    if (!penaltyId) {
      const penaltyResult = await supabase.from("penalties").insert({
        attendance_id: attendanceResult.data.id, person_id: lateForm.person_id,
        amount_fcfa: amount, status: "pending", penalty_type: "late_arrival"
      }).select("id").single();
      if (penaltyResult.error || !penaltyResult.data) {
        setError("Le retard est enregistré, mais le dossier de règlement n’a pas pu être créé. L’accès reste bloqué. Détail : " + (penaltyResult.error?.message || "erreur inconnue"));
        await loadRows("attendance"); setBusy(false); return;
      }
      penaltyId = penaltyResult.data.id;
    }
    const paymentResult = await supabase.from("payments").insert({
      payment_type: "penalty", payment_category: "penalty",
      penalty_id: penaltyId, person_id: lateForm.person_id,
      amount_fcfa: paymentAmount, method: lateForm.method,
      provider: lateForm.provider.trim() || null,
      transaction_reference: lateForm.transaction_reference.trim() || null,
      status: "pending", received_at: arrivedAt.toISOString(), received_by: user.id
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
      setNotice(`Retard enregistré : ${delayMinutes} minute(s). Paiement de ${paymentAmount.toLocaleString("fr-FR")} FCFA validé. Accès autorisé — dossier affiché en jaune.`);
      setLateForm({ person_type: "student", person_id: "", planned_time: "08:00", arrived_time: "", amount_fcfa: "", method: "cash", provider: "", transaction_reference: "", reason: "" });
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
    const html = "<!doctype html><html lang=\x22fr\x22><head><meta charset=\x22utf-8\x22><title>Reçu Aéro Service</title><style>body{font:16px Arial,sans-serif;color:#172033;padding:36px;max-width:720px;margin:auto}header{text-align:center;border-bottom:2px solid #172033;padding-bottom:18px;margin-bottom:24px}h1{font-size:25px;margin:0 0 8px}.number{font-size:20px;font-weight:bold;margin:18px 0}.line{display:flex;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid #dbe2ea}.line b{text-align:right}.amount{font-size:22px;font-weight:bold}.foot{margin-top:35px;font-size:12px;color:#586579;text-align:center}@media print{button{display:none}body{padding:0}}</style></head><body><header><img src=\x22/aero-service-logo.svg\x22 alt=\x22Logo officiel Aéro Service\x22 style=\x22display:block;width:120px;height:90px;object-fit:contain;margin:0 auto 12px\x22/><h1>AÉRO SERVICE</h1><div>Reçu officiel de paiement</div><small>Gestion &amp; formation</small></header><div class=\x22number\x22>N° " + escapeHtml(payment.receipt_number) + "</div><div class=\x22line\x22><span>Payeur / bénéficiaire</span><b>" + escapeHtml(payer) + "</b></div><div class=\x22line\x22><span>Nature du paiement</span><b>" + escapeHtml(category) + "</b></div><div class=\x22line\x22><span>Description</span><b>" + escapeHtml(payment.payment_description || payment.transaction_reference || "—") + "</b></div><div class=\x22line\x22><span>Mode de paiement</span><b>" + escapeHtml(payment.method || "Non précisé") + "</b></div><div class=\x22line\x22><span>Date de validation</span><b>" + escapeHtml(date) + "</b></div><div class=\x22line\x22><span>Montant reçu</span><b class=\x22amount\x22>" + escapeHtml(amount) + " FCFA</b></div><div class=\x22foot\x22>Conservez ce reçu comme preuve de paiement.</div><p style=\x22text-align:center;margin-top:30px\x22><button onclick=\x22window.print()\x22>Imprimer / Enregistrer en PDF</button></p></body></html>";
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
    const reviewComment = decision === "approved"
      ? "Dossier vérifié et approuvé par le secrétariat."
      : "Demande rejetée par le secrétariat. Veuillez contacter le secrétariat pour plus d’informations.";
    const { data, error: reviewError } = await supabase.functions.invoke("review-registration", {
      body: { registration_id: registrationId, decision, comment: reviewComment }
    });
    if (reviewError || !data?.ok) {
      const detail = data?.detail || data?.error || reviewError?.message || "La décision n’a pas été enregistrée.";
      setError("La validation n’a pas abouti. Aucun succès ne sera affiché tant que le serveur ne l’a pas confirmé. " + detail);
    } else if (decision === "approved") {
      setNotice("VALIDATION CONFIRMÉE : inscription approuvée, compte activé, rôle apprenant confirmé et dossier de formation prêt pour le pointage QR.");
    } else {
      setNotice("Demande d’inscription rejetée et décision enregistrée.");
    }
    await loadRows("registrations");
    await loadCounts();
    setBusy(false);
  }

  async function submitAbsenceJustification(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) { setError("Reconnectez-vous pour envoyer un justificatif."); return; }
    setBusy(true); setError(""); setNotice("");
    const { data, error: rpcError } = await supabase.rpc("submit_absence_justification", {
      p_attendance_id: justificationForm.attendance_id, p_reason_type: justificationForm.reason_type,
      p_reason: justificationForm.reason.trim(), p_document_url: justificationForm.document_url.trim() || null
    });
    if (rpcError || !data?.ok) setError(rpcError?.message || "Le justificatif n’a pas été enregistré.");
    else { setNotice("Justificatif transmis au secrétariat pour examen."); setJustificationForm({attendance_id:"",reason_type:"medical",reason:"",document_url:""}); await loadRows("justifications"); }
    setBusy(false);
  }

  async function reviewAbsenceJustification(row: Record<string, unknown>, decision: "approved" | "rejected") {
    setBusy(true); setError(""); setNotice("");
    const { data, error: rpcError } = await supabase.rpc("review_absence_justification", {
      p_justification_id: String(row.id ?? ""), p_decision: decision,
      p_comment: decision === "approved" ? "Justificatif validé par le secrétariat." : "Justificatif rejeté. Veuillez contacter le secrétariat."
    });
    if (rpcError || !data?.ok) setError(rpcError?.message || "La décision n’a pas été enregistrée.");
    else setNotice(decision === "approved" ? "Justificatif approuvé." : "Justificatif rejeté.");
    await loadRows("justifications"); setBusy(false);
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
  // Keep account-creation UI aligned with the Edge Function authorization check.
  const canCreateStaffAccount = roles.some(r => ["SECRETARIAT", "DIRECTOR"].includes(r.code.toUpperCase()));
  const roleCodes = roles.map(r => r.code.toUpperCase());
  const visibleModules = modules.filter(m => canAccessModule(m.key, roleCodes));
  const isLearner = roleCodes.some(code => ["STUDENT","APPRENANT"].includes(code));
  const roleLabel = isAdmin ? "Direction / Administration" : isSecretary ? "Secrétariat" : roleCodes.some(code => ["PEDAGOGY","PEDAGOGIE"].includes(code)) ? "Pédagogie" : roleCodes.some(code => ["TEACHER","ENSEIGNANT"].includes(code)) ? "Enseignant" : roleCodes.some(code => ["ACCOUNTING","FINANCE"].includes(code)) ? "Comptabilité / Finance" : roleCodes.some(code => ["STAFF","PERSONNEL"].includes(code)) ? "Personnel" : isLearner ? "Apprenant" : "Accès à définir";

  useEffect(() => {
    if (mode !== "signup" && !user) return;
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
  }, [mode, user]);

  if (!user || mode === "new-password") return <main className="login-screen">
    <section className="login-visual">
      <div className="brand"><div className="brand-mark"><img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" /></div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Plateforme de gestion</div></div></div>
      <div className="login-visual-content"><div className="eyebrow" style={{color:"#9cc5ff"}}>FORMATION · ORGANISATION · SUIVI</div><h1>Prenez de la hauteur sur votre gestion.</h1><p>Un espace centralisé pour piloter les formations, suivre les apprenants et coordonner les opérations de votre établissement.</p><div className="login-bullets"><span>✦ Gestion pédagogique</span><span>✦ Suivi administratif</span><span>✦ Accès sécurisé</span></div></div>
      <div style={{fontSize:11,color:"#9db2c8",position:"relative",zIndex:1}}>© {new Date().getFullYear()} Aéro Service · Espace sécurisé</div>
    </section>
    <section className="login-form-side"><div className="login-card">
      <div className="brand" style={{padding:"0 0 30px"}}><div className="brand-mark" style={{background:"#fff",color:"#2474e5"}}><img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" /></div><div><div className="brand-name" style={{color:"#10243b"}}>AÉRO SERVICE</div><div className="brand-sub" style={{color:"#758396"}}>ESPACE DE CONNEXION</div></div></div>
      <h2>{mode === "login" ? "Bon retour parmi nous" : mode === "signup" ? "Créer un compte apprenant" : mode === "new-password" ? "Choisir un nouveau mot de passe" : "Réinitialiser le mot de passe"}</h2><p>{mode === "login" ? "Connectez-vous pour accéder à votre espace de travail." : mode === "signup" ? "Inscrivez-vous à une formation Aéro Service. Votre dossier sera vérifié par le secrétariat." : mode === "new-password" ? "Le lien est validé. Définissez puis confirmez votre nouveau mot de passe." : "Recevez un lien sécurisé par e-mail."}</p>
      {error && <div className="toast error-message">{error}</div>}{notice && <div className="toast">{notice}</div>}
      <form className="login-fields" onSubmit={mode === "login" ? handleLogin : mode === "signup" ? handleSignup : mode === "new-password" ? handleUpdatePassword : handleReset}>
        {mode === "signup" && <><label className="field">Nom et prénom<input type="text" autoComplete="name" required value={signupName} onChange={e=>setSignupName(e.target.value)} placeholder="Ex. Aïcha Dossou"/></label><label className="field">Téléphone<input type="tel" autoComplete="tel" value={signupPhone} onChange={e=>setSignupPhone(e.target.value)} placeholder="Ex. 01 90 00 00 00"/></label><label className="field">Formation souhaitée<select required value={signupFormation} onChange={e=>setSignupFormation(e.target.value)}><option value="">{publicFormations.length ? "Choisir une formation" : "Aucune formation disponible pour le moment"}</option>{publicFormations.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label></>}
        <label className="field">Adresse e-mail<input type="email" autoComplete="email" placeholder="vous@exemple.com" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
        {mode !== "reset" && <label className="field">{mode === "new-password" ? "Nouveau mot de passe" : "Mot de passe"}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} placeholder="8 caractères minimum" required value={password} onChange={e=>setPassword(e.target.value)} /></label>}
        {mode === "new-password" && <label className="field">Confirmer le nouveau mot de passe<input type="password" autoComplete="new-password" minLength={8} placeholder="Répétez le nouveau mot de passe" required value={passwordConfirmation} onChange={e=>setPasswordConfirmation(e.target.value)} /></label>}
        <button className="btn btn-primary" style={{width:"100%",padding:13,marginTop:4}} disabled={busy}>{busy ? "Veuillez patienter…" : mode === "login" ? "Se connecter  →" : mode === "signup" ? "Créer mon compte et envoyer la demande" : mode === "new-password" ? "Enregistrer le nouveau mot de passe" : "Envoyer le lien"}</button>
      </form>
      <button className="link-btn" onClick={()=>{setMode(mode==="login"?"reset":"login");setError("");setNotice("");}}>{mode==="login"?"Mot de passe oublié ?":"← Retour à la connexion"}</button>
      {mode === "login" && <button className="link-btn" onClick={()=>{setMode("signup");setError("");setNotice("");setPassword("");}}>Créer un compte apprenant</button>}
      {mode === "signup" && <button className="link-btn" onClick={()=>{setMode("login");setError("");setNotice("");setPassword("");}}>← Retour à la connexion</button>}
      <div className="login-foot">La connexion est sécurisée par Supabase Auth.<br/>L’accès aux données dépend de votre rôle et des règles de sécurité.</div>
    </div></section>
  </main>;

  return <div className="app-shell">
    <aside className={"sidebar" + (mobileNav ? " mobile-open" : "")}>
      <div className="brand"><div className="brand-mark"><img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" /></div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Gestion & formation</div></div></div>
      {["PILOTAGE","PÉDAGOGIE","ORGANISATION","ADMINISTRATION","FINANCES","SYSTÈME"].map(section => visibleModules.some(m=>m.section===section) ? <div key={section}><div className="nav-label">{section}</div>{visibleModules.filter(m=>m.section===section).map(m=><button key={m.key} className={"nav-item"+(active===m.key?" active":"")} onClick={()=>{setActive(m.key);setSearch("");setShowCreate(false);setMobileNav(false);setNotice("");setError("");}}><span className="nav-icon">{m.icon}</span>{m.label}</button>)}</div> : null)}
      {!isLearner && <><a className="nav-item" href="/presence/borne"><span className="nav-icon">◉</span>Borne apprenants</a>
      <a className="nav-item" href="/presence/personnel-qr"><span className="nav-icon">◉</span>Borne du personnel</a>
      <a className="nav-item" href="/presence/qr-affiche"><span className="nav-icon">▦</span>QR apprenants à imprimer</a>
      <a className="nav-item" href="/presence/personnel-qr-affiche"><span className="nav-icon">▦</span>QR personnel à imprimer</a>
      <a className="nav-item" href="/presence/secretariat"><span className="nav-icon">✓</span>Pointages à confirmer</a>
      {isAdmin && <a className="nav-item" href="/direction/suivi"><span className="nav-icon">▤</span>Suivi Direction</a>}</>}
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
            ...(isAdmin ? [{key:"direction-report" as const,icon:"▤",title:"Suivi des présences",desc:"Noms et prénoms : à l’heure, en retard et absents"}] : []),
            {key:"payments" as ModuleKey,icon:"₣",title:"Suivi des paiements",desc:"Consulter les règlements"},
            {key:"roles" as ModuleKey,icon:"⚿",title:"Rôles & autorisations",desc:"Consulter les rôles configurés"}
          ].filter(q => q.key === "direction-report" || canAccessModule(q.key as ModuleKey, roleCodes)).map(q=><button className="quick-action" key={q.key} onClick={()=>{if(q.key==="direction-report"){window.location.href="/direction/suivi";return;}setActive(q.key as ModuleKey);setSearch("");setError("");}}><span className="quick-icon">{q.icon}</span><span><div className="quick-title">{q.title}</div><div className="quick-desc">{q.desc}</div></span><span style={{marginLeft:"auto",color:"#9aa8b8"}}>→</span></button>)}</div></div></div>}
          {isLearner && <div className="panel"><div className="panel-head"><div><div className="panel-title">Votre formation</div><div className="panel-desc">Formation affectée à votre compte lors de la création par le Secrétariat.</div></div><span className="pill active">Compte apprenant</span></div><div className="panel-body" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:20}}><div><div className="stat-foot">Formation</div><div style={{fontSize:15,fontWeight:700,marginTop:7}}>{accountFormation?.name || "Formation non récupérée"}</div></div><div><div className="stat-foot">Code</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{accountFormation?.code || "—"}</div></div><div><div className="stat-foot">Numéro apprenant</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{studentNumber || "Non renseigné"}</div></div><div><div className="stat-foot">État de la formation</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{accountFormation?.status ? pretty(accountFormation.status) : "Non disponible"}</div></div></div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Votre session</div><div className="panel-desc">Informations du compte actuellement connecté.</div></div><span className="pill active">● Connecté</span></div><div className="panel-body" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:20}}><div><div className="stat-foot">Adresse e-mail</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{user.email}</div></div><div><div className="stat-foot">Identifiant public</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{profile?.public_id||"Non renseigné"}</div></div><div><div className="stat-foot">Rôles attribués</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{roles.map(r=>r.name).join(", ")||"Aucun rôle chargé"}</div></div><div><div className="stat-foot">Statut du profil</div><div style={{marginTop:7}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status ? pretty(profile.status) : identityReady ? "Statut indisponible" : "Chargement…"}</span></div></div></div></div>
        </>}
        {active!=="dashboard" && active!=="settings" && <>
          <div className="page-heading"><div><div className="eyebrow">{activeModule.section}</div><h1 className="page-title">{activeModule.label}</h1><p className="page-subtitle">{active === "attendance" ? "Enregistrez le retard, validez le montant payé et autorisez l’accès à l’apprenant." : activeModule.description}</p></div>{((["formations","students","registrations","groups","subjects","rooms"].includes(active)&&(isAdmin||(active==="registrations"&&canCreateStaffAccount)))||(active==="penalties"&&roles.some(role=>["SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","DIRECTOR","PRE_ADMIN","ADMIN"].includes(role.code.toUpperCase())))||(active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))))&&<button className="btn btn-primary" onClick={()=>setShowCreate(!showCreate)}>{showCreate?"Fermer":active==="formations"?"＋ Ajouter une formation":active==="students"?"＋ Ajouter un dossier":active==="registrations"?"＋ Nouvelle inscription":active==="groups"?"＋ Ajouter un groupe":active==="subjects"?"＋ Ajouter une matière":active==="payments"?"＋ Enregistrer un paiement":active==="penalties"?"＋ Nouvelle pénalité":"＋ Ajouter une salle"}</button>}</div>
          {active === "justifications" && <div className="panel"><div className="panel-head"><div><div className="panel-title">{isLearner ? "Soumettre un justificatif d’absence" : "Traitement des justificatifs"}</div><div className="panel-desc">{isLearner ? "Sélectionnez une absence enregistrée, expliquez le motif et joignez éventuellement un lien vers le document." : "Le secrétariat et la Direction peuvent approuver ou rejeter les demandes en attente."}</div></div></div><div className="panel-body">{isLearner ? <form onSubmit={submitAbsenceJustification}><div className="form-grid"><label className="field">Absence à justifier<select required value={justificationForm.attendance_id} onChange={e=>setJustificationForm({...justificationForm,attendance_id:e.target.value})}><option value="">Choisir une absence</option>{absenceCandidates.map(item=><option key={item.id} value={item.id}>{item.planned_at ? new Date(item.planned_at).toLocaleString("fr-FR",{timeZone:"Africa/Porto-Novo"}) : "Séance"} · {item.status}</option>)}</select></label><label className="field">Motif<select required value={justificationForm.reason_type} onChange={e=>setJustificationForm({...justificationForm,reason_type:e.target.value})}><option value="medical">Médical</option><option value="family">Familial</option><option value="transport">Transport</option><option value="administrative">Administratif</option><option value="other">Autre</option></select></label><label className="field">Lien vers le document (facultatif)<input type="url" value={justificationForm.document_url} onChange={e=>setJustificationForm({...justificationForm,document_url:e.target.value})} placeholder="https://…"/></label><label className="field">Explication<textarea required minLength={5} value={justificationForm.reason} onChange={e=>setJustificationForm({...justificationForm,reason:e.target.value})} placeholder="Expliquez votre absence"/></label></div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || absenceCandidates.length===0}>{busy?"Envoi…":"Envoyer le justificatif"}</button></div>{absenceCandidates.length===0&&<p className="panel-desc">Aucune absence enregistrée à justifier pour le moment.</p>}</form> : <p className="panel-desc">Les demandes visibles ci-dessous sont filtrées par les autorisations du compte. Ouvrez une demande en attente pour enregistrer une décision.</p>}</div></div>}
          {active === "penalties" && <div className="panel" style={{marginBottom:16}}><div className="panel-head"><div><div className="panel-title">Règles générales de pénalité</div><div className="panel-desc">Définissez une règle une seule fois pour les apprenants et le personnel. Créer une règle ne facture personne immédiatement.</div></div></div><div className="panel-body">{!ruleSchemaReady && <div className="notice notice-warning" role="status">La base utilisée par cette prévisualisation ne possède pas encore les colonnes des règles générales. La migration doit être appliquée à une base de test avant l’enregistrement.</div>}<form onSubmit={createPenaltyRule}><div className="form-grid"><label className="field">Formation concernée<select value={ruleForm.formation_id} onChange={e=>setRuleForm({...ruleForm,formation_id:e.target.value})}><option value="">Toutes les formations (règle générale)</option>{formationOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><label className="field">Motif<select required value={ruleForm.penalty_type} onChange={e=>setRuleForm({...ruleForm,penalty_type:e.target.value,application_mode:e.target.value==="late_arrival"?ruleForm.application_mode:"manual"})}><option value="late_arrival">Retard</option><option value="unjustified_absence">Absence injustifiée</option><option value="early_departure">Départ anticipé</option><option value="repeated_absence">Absences répétées</option><option value="noncompliance">Non-respect du règlement</option><option value="misconduct">Comportement inapproprié</option><option value="equipment_damage">Dégradation de matériel</option><option value="equipment_loss">Perte de matériel</option><option value="badge_loss">Perte de badge</option><option value="incomplete_file">Dossier incomplet</option><option value="late_payment">Retard de paiement</option><option value="unauthorized_access">Accès non autorisé</option><option value="safety_violation">Infraction à la sécurité</option><option value="exam_misconduct">Fraude ou incident d’examen</option><option value="other">Autre</option></select></label><label className="field">Personnes visées<select required value={ruleForm.target_scope} onChange={e=>setRuleForm({...ruleForm,target_scope:e.target.value})}><option value="all">Tout le monde (apprenants et personnel)</option><option value="students">Apprenants seulement</option><option value="staff">Personnel seulement</option><option value="teacher">Formateurs / enseignants seulement</option></select></label><label className="field">Mode d’application<select required value={ruleForm.application_mode} onChange={e=>setRuleForm({...ruleForm,application_mode:e.target.value})}><option value="automatic" disabled={ruleForm.penalty_type!=="late_arrival"}>Automatique lors du pointage (retards uniquement)</option><option value="manual">Manuel par l’administration</option></select></label><label className="field">Heure limite d’arrivée (facultative)<input type="time" value={ruleForm.applies_after_time} onChange={e=>setRuleForm({...ruleForm,applies_after_time:e.target.value})}/><small>Si elle reste vide, la limite sera calculée à partir de l’heure de début de la séance + la tolérance.</small></label><label className="field">Retard minimum (minutes)<input type="number" min="0" step="1" required value={ruleForm.min_delay_minutes} onChange={e=>setRuleForm({...ruleForm,min_delay_minutes:e.target.value})}/></label><label className="field">Retard maximum (minutes, facultatif)<input type="number" min="1" step="1" value={ruleForm.max_delay_minutes} onChange={e=>setRuleForm({...ruleForm,max_delay_minutes:e.target.value})} placeholder="Vide = sans maximum"/></label><label className="field">Tolérance (minutes)<input type="number" min="0" step="1" required value={ruleForm.tolerance_minutes} onChange={e=>setRuleForm({...ruleForm,tolerance_minutes:e.target.value})}/></label><label className="field">Montant (FCFA)<input type="number" min="1" step="1" required value={ruleForm.amount_fcfa} onChange={e=>setRuleForm({...ruleForm,amount_fcfa:e.target.value})}/></label><label className="field">Description / conditions<input value={ruleForm.description} onChange={e=>setRuleForm({...ruleForm,description:e.target.value})} placeholder="Ex. retard après l’heure de début"/></label></div><div className="form-actions">{editingRuleId&&<button type="button" className="btn" disabled={busy} onClick={()=>{setEditingRuleId(null);setRuleForm({formation_id:"",penalty_type:"late_arrival",description:"",target_scope:"students",application_mode:"automatic",applies_after_time:"",min_delay_minutes:"1",max_delay_minutes:"20",tolerance_minutes:"0",amount_fcfa:"1000"});}}>Annuler la modification</button>}<button type="submit" className="btn btn-primary" disabled={busy || !ruleSchemaReady}>{busy?"Enregistrement…":editingRuleId?"Mettre à jour la règle":"Enregistrer la règle générale"}</button></div></form><div className="panel" style={{marginTop:18}}><div className="panel-head"><div><div className="panel-title">Appliquer une règle manuellement</div><div className="panel-desc">Crée une pénalité à régler pour une personne précise, sans encaisser ni valider le paiement.</div></div></div><div className="panel-body"><form onSubmit={applyPenaltyRule}><div className="form-grid"><label className="field">Règle active<select required value={applyRuleForm.rule_id} onChange={e=>setApplyRuleForm({...applyRuleForm,rule_id:e.target.value})}><option value="">Choisir une règle</option>{penaltyRules.filter(rule=>rule.active && rule.application_mode==="manual").map(rule=><option key={rule.id} value={rule.id}>{rule.penalty_type} — {Number(rule.amount_fcfa).toLocaleString("fr-FR")} FCFA{rule.description?" — "+rule.description:""}</option>)}</select></label><label className="field">Personne concernée<select required value={applyRuleForm.person_id} onChange={e=>setApplyRuleForm({...applyRuleForm,person_id:e.target.value})}><option value="">Choisir une personne</option>{profileOptions.filter(person=>{const rule=penaltyRules.find(item=>item.id===applyRuleForm.rule_id);if(!rule||rule.target_scope==="all")return true;if(rule.target_scope==="staff")return staffIds.includes(person.id);if(rule.target_scope==="teacher")return teacherIds.includes(person.id);if(rule.target_scope==="students")return studentIds.includes(person.id);return false;}).map(person=><option key={person.id} value={person.id}>{person.display_name||[person.first_name,person.last_name].filter(Boolean).join(" ")||person.public_id||person.id}</option>)}</select></label></div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || !ruleSchemaReady}>Attribuer la pénalité</button></div></form></div></div><div className="panel" style={{marginTop:18}}><div className="panel-head"><div><div className="panel-title">Règles enregistrées</div><div className="panel-desc">{penaltyRules.length} règle(s) chargée(s)</div></div></div><div className="panel-body">{penaltyRules.length===0?<p>Aucune règle générale disponible pour le moment.</p>:<div className="table-wrap"><table><thead><tr><th>Formation</th><th>Motif</th><th>Public</th><th>Mode</th><th>Plage (min)</th><th>Heure limite</th><th>Tolérance</th><th>Montant</th><th>État</th><th>Actions</th></tr></thead><tbody>{penaltyRules.map(rule=><tr key={rule.id}><td>{formationOptions.find(item=>item.id===rule.formation_id)?.name||"Toutes les formations"}</td><td>{rule.penalty_type||"Autre"}{rule.description?" — "+rule.description:""}</td><td>{rule.target_scope==="all"?"Tout le monde":rule.target_scope==="students"?"Apprenants":rule.target_scope==="staff"?"Personnel":"Enseignants"}</td><td>{rule.application_mode==="automatic"?"Automatique":"Manuel"}</td><td>{Number(rule.min_delay_minutes??0)}–{rule.max_delay_minutes==null?"∞":Number(rule.max_delay_minutes)} min</td><td>{rule.applies_after_time||"Début + tolérance"}</td><td>{Number(rule.tolerance_minutes||0)} min</td><td>{Number(rule.amount_fcfa).toLocaleString("fr-FR")} FCFA</td><td>{rule.active?"Active":"Inactive"}</td><td>{roles.some(role=>["DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))&&<button className="btn" disabled={busy} onClick={()=>{setEditingRuleId(String(rule.id));setRuleForm({formation_id:rule.formation_id||"",penalty_type:rule.penalty_type||"late_arrival",description:rule.description||"",target_scope:rule.target_scope||"students",application_mode:rule.application_mode||"automatic",applies_after_time:rule.applies_after_time||"",min_delay_minutes:String(rule.min_delay_minutes??1),max_delay_minutes:rule.max_delay_minutes==null?"":String(rule.max_delay_minutes),tolerance_minutes:String(rule.tolerance_minutes??0),amount_fcfa:String(rule.amount_fcfa??1000)});setError("");setNotice("");}}>Modifier</button>}</td></tr>)}</tbody></table></div>}</div></div></div></div>}{active === "attendance" && isSecretary && <div className="panel late-panel"><div className="panel-head"><div><div className="panel-title">Retard et autorisation d’accès</div><div className="panel-desc">{isAdmin ? "Pour les apprenants et le personnel. Le DG et l’administration retrouvent les retards et paiements validés." : "Réservé aux apprenants : après validation du paiement, leur accès est autorisé. La secrétaire ne peut pas valider l’accès du personnel."}</div></div><span className="pill late-status">● Validation secrétaire</span></div><div className="panel-body"><form onSubmit={registerLateArrival}><div className="form-grid">{isAdmin && <label className="field">Catégorie<select required value={lateForm.person_type} onChange={e=>setLateForm({...lateForm,person_type:e.target.value,person_id:""})}><option value="student">Apprenant</option><option value="staff">Personnel</option></select></label>}<label className="field">{lateForm.person_type === "staff" ? "Membre du personnel" : "Apprenant"}<select required value={lateForm.person_id} onChange={e=>setLateForm({...lateForm,person_id:e.target.value})}><option value="">Rechercher / choisir une personne</option>{profileOptions.filter(item=>lateForm.person_type !== "staff" || staffIds.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.public_id ? item.public_id + " — " : ""}{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(" ")||item.id}</option>)}</select></label><label className="field">Heure normale d’arrivée<input type="time" required value={lateForm.planned_time} onChange={e=>setLateForm({...lateForm,planned_time:e.target.value})}/></label><label className="field">Heure d’arrivée constatée<input type="time" value={lateForm.arrived_time} onChange={e=>setLateForm({...lateForm,arrived_time:e.target.value})} /></label><label className="field">Montant payé (FCFA)<input type="number" min="1" step="1" required value={lateForm.amount_fcfa} onChange={e=>setLateForm({...lateForm,amount_fcfa:e.target.value})} placeholder="Ex. 1000"/></label><label className="field">Mode de paiement<select required value={lateForm.method} onChange={e=>setLateForm({...lateForm,method:e.target.value})}><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="other">Autre</option></select></label><label className="field">Opérateur (facultatif)<input value={lateForm.provider} onChange={e=>setLateForm({...lateForm,provider:e.target.value})} placeholder="Ex. MTN, Moov…"/></label><label className="field">Référence du paiement (facultatif)<input value={lateForm.transaction_reference} onChange={e=>setLateForm({...lateForm,transaction_reference:e.target.value})} placeholder="Référence ou numéro de reçu"/></label><label className="field">Motif / observation (facultatif)<input value={lateForm.reason} onChange={e=>setLateForm({...lateForm,reason:e.target.value})} placeholder="Ex. transport, circulation…"/></label></div><div className="late-preview"><span className="late-dot"></span><div><strong>Après validation réussie</strong><p>Le statut devient « Retard régularisé », la ligne apparaît en jaune et l’accès est autorisé. Le montant est conservé dans le suivi des paiements.</p></div></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setLateForm({person_type:"student",person_id:"",planned_time:"08:00",arrived_time:"",amount_fcfa:"",method:"cash",provider:"",transaction_reference:"",reason:""})}>Effacer</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Validation en cours…":"Valider le paiement et autoriser l’accès"}</button></div></form></div></div>}
          {active==="registrations"&&showCreate&&canCreateStaffAccount&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer et valider l’inscription d’un nouvel arrivant</div><div className="panel-desc">Pour un apprenant, une seule validation crée les identifiants, active le profil, approuve l’inscription et rend le dossier reconnaissable par la borne QR. Aucune approbation séparée ensuite. Les rôles Direction et Pré-administrateur sont interdits ici.</div></div></div><div className="panel-body"><form onSubmit={createAccountForRegistration}><div className="form-grid"><label className="field">Nom et prénom<input required value={newAccount.display_name} onChange={e=>setNewAccount({...newAccount,display_name:e.target.value})} placeholder="Nom complet"/></label><label className="field">Adresse e-mail (identifiant)<input type="email" required value={newAccount.email} onChange={e=>setNewAccount({...newAccount,email:e.target.value})} placeholder="eleve@exemple.com"/></label><label className="field">Mot de passe initial<input type="password" required minLength={8} value={newAccount.password} onChange={e=>setNewAccount({...newAccount,password:e.target.value})} placeholder="8 caractères minimum"/></label><label className="field">Téléphone (facultatif)<input value={newAccount.phone} onChange={e=>setNewAccount({...newAccount,phone:e.target.value})} placeholder="Téléphone"/></label><label className="field">Rôle à attribuer<select required value={newAccount.role_code} onChange={e=>setNewAccount({...newAccount,role_code:e.target.value})}><option value="STUDENT">Apprenant</option><option value="TEACHER">Enseignant</option><option value="STAFF">Personnel</option><option value="TRAVEL_AGENT">Agent de voyage</option><option value="ACCOUNTING">Comptabilité / Finance</option><option value="PEDAGOGY">Responsable pédagogique</option></select></label>{newAccount.role_code==="STUDENT"&&<label className="field">Formation de l’apprenant<select required value={newAccount.formation_id} onChange={e=>setNewAccount({...newAccount,formation_id:e.target.value})}><option value="">Choisir une formation</option>{publicFormations.map(f=><option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}</select></label>}</div><div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Création et validation…":newAccount.role_code==="STUDENT"?"Créer et valider l’inscription":"Créer le compte et attribuer le rôle"}</button></div></form></div></div>}
          {active!=="formations"&&showCreate&&(isAdmin||(active==="registrations"&&isSecretary)||(active==="penalties"&&roles.some(role=>["SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","DIRECTOR","PRE_ADMIN","ADMIN"].includes(role.code.toUpperCase())))||(active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))))&&createFields[active]&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer un enregistrement</div><div className="panel-desc">{active==="payments"?"Le paiement sera créé en attente de validation. Aucun reçu ne sera émis avant validation.":active==="penalties"?"Cette création sert à enregistrer une pénalité individuelle exceptionnelle. Pour une règle générale, utilisez le panneau ci-dessus.":"Les données seront enregistrées dans la base existante, selon les autorisations Supabase."}</div></div></div><div className="panel-body"><form onSubmit={createModuleRecord}><div className="form-grid">{createFields[active].filter(field => active !== "payments" || (field.name === "penalty_id" ? createValues.payment_type === "penalty" : ["person_id","payer_name","payer_phone","payer_identifier","payment_description","payment_category","amount_fcfa"].includes(field.name) ? createValues.payment_type === "ordinary" : true)).map(field=><label className="field" key={field.name}>{field.label}{field.type==="formation"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une formation</option>{formationOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="group"?<select value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir un groupe</option>{groupOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="penalty"?<select required={field.required || (active==="payments" && field.name==="penalty_id" && createValues.payment_type==="penalty")} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">{penaltyOptions.length ? "Choisir une pénalité à régler" : "Aucune pénalité créée/en attente — créez-la d’abord dans le module Pénalités"}</option>{penaltyOptions.map(item=>{const person=profileOptions.find(p=>p.id===item.person_id);const name=person?.display_name||[person?.first_name,person?.last_name].filter(Boolean).join(" ")||person?.public_id||"Bénéficiaire";const labels:Record<string,string>={late_arrival:"Retard",unjustified_absence:"Absence injustifiée",early_departure:"Départ anticipé",repeated_absence:"Absences répétées",noncompliance:"Non-respect du règlement",misconduct:"Comportement inapproprié",equipment_damage:"Dégradation de matériel",equipment_loss:"Perte de matériel",badge_loss:"Perte de badge",incomplete_file:"Dossier incomplet",late_payment:"Retard de paiement",unauthorized_access:"Accès non autorisé",safety_violation:"Infraction aux règles de sécurité",exam_misconduct:"Fraude ou incident d’examen",other:"Autre pénalité"};const type=labels[item.penalty_type||""]||"Autre pénalité";return <option key={item.id} value={item.id}>{type} — {name} — {Number(item.amount_fcfa).toLocaleString("fr-FR")} FCFA{item.description?` — ${item.description}`:""} — ${item.id.slice(0,8).toUpperCase()}</option>;})}</select>:field.type==="penalty"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une pénalité en attente</option>{penaltyOptions.map(item=><option key={item.id} value={item.id}>{(profileOptions.find(p=>p.id===item.person_id)?.display_name||[profileOptions.find(p=>p.id===item.person_id)?.first_name,profileOptions.find(p=>p.id===item.person_id)?.last_name].filter(Boolean).join(" ")||"Bénéficiaire")} — {Number(item.amount_fcfa).toLocaleString("fr-FR")} FCFA</option>)}</select>:field.type==="penalty"?<select required={(createValues.payment_kind??"ordinary")==="penalty"} disabled={(createValues.payment_kind??"ordinary")!=="penalty"} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une pénalité</option>{penaltyOptions.filter(item=>["pending","unpaid","due","open"].includes((item.status||"").toLowerCase())).map(item=><option key={item.id} value={item.id}>{(profileOptions.find(p=>p.id===item.person_id)?.display_name||profileOptions.find(p=>p.id===item.person_id)?.public_id||"Bénéficiaire")} — {Number(item.amount_fcfa).toLocaleString("fr-FR")} FCFA — {item.status}</option>)}</select>:field.type==="profile"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une personne</option>{profileOptions.map(item=><option key={item.id} value={item.id}>{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(" ")||item.public_id||item.id}</option>)}</select>:field.type==="select"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir…</option>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input type={field.type??"text"} min={field.type==="number"?(active==="payments"?1:0):undefined} step={field.type==="number"&&active==="payments"?1:undefined} required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})} placeholder={field.type==="number"?"0":field.label}/>}</label>)}</div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":active==="payments"?"Enregistrer en attente de validation":active==="penalties"?"Créer la pénalité":"Enregistrer"}</button></div></form></div></div>}
          {active==="formations"&&showCreate&&isAdmin&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer une formation</div><div className="panel-desc">Les champs code et nom sont obligatoires.</div></div></div><div className="panel-body"><form onSubmit={createFormation}><div className="form-grid"><label className="field">Code de la formation<input required value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="Ex. PILOTAGE-01"/></label><label className="field">Nom de la formation<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex. Initiation au pilotage"/></label><label className="field">Durée<input value={form.duration} onChange={e=>setForm({...form,duration:e.target.value})} placeholder="Ex. 6 mois"/></label><label className="field">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Présentation de la formation"/></label></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":"Enregistrer la formation"}</button></div></form></div></div>}
          {active==="payments"&&receiptPayment&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Reçu de paiement généré</div><div className="panel-desc">Le paiement est validé et le reçu est disponible dans votre espace comptable.</div></div><button className="btn btn-primary" onClick={()=>printReceipt(receiptPayment)}>Imprimer / Enregistrer en PDF</button></div><div className="panel-body"><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14}}><div><div className="stat-foot">Numéro du reçu</div><strong>{String(receiptPayment.receipt_number||"En cours d’attribution")}</strong></div><div><div className="stat-foot">Payeur</div><strong>{String(receiptPayment.payer_name||profileOptions.find(p=>p.id===String(receiptPayment.person_id))?.display_name||[profileOptions.find(p=>p.id===String(receiptPayment.person_id))?.first_name,profileOptions.find(p=>p.id===String(receiptPayment.person_id))?.last_name].filter(Boolean).join(" ")||"Personne extérieure")}</strong></div><div><div className="stat-foot">Nature</div><strong>{String(receiptPayment.payment_category||"").replace(/_/g," ")}</strong></div><div><div className="stat-foot">Montant</div><strong>{Number(receiptPayment.amount_fcfa||0).toLocaleString("fr-FR")} FCFA</strong></div></div></div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">{activeModule.label} enregistrés</div><div className="panel-desc">Données affichées selon vos autorisations · maximum 100 lignes</div></div><div className="table-toolbar"><input className="search-box" placeholder="Rechercher dans les résultats…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn btn-quiet" onClick={()=>void loadRows(active)}>↻ Actualiser</button></div></div>
            {loading?<div className="loading">Chargement des données…</div>:filteredRows.length===0?<div className="empty-state"><div className="empty-icon">⌕</div><strong>{rows.length===0?"Aucune donnée à afficher":"Aucun résultat"}</strong><div style={{marginTop:7}}>{rows.length===0?"Ce module est vide ou les règles d’accès empêchent la lecture.":"Essayez avec un autre terme de recherche."}</div></div>:<div className="table-wrap"><table><thead><tr>{Object.keys(filteredRows[0]).filter(k=>k!=="id").map(k=><th key={k}>{k==="person_id"?"Compte lié":k==="payer_name"?"Payeur":k==="payment_category"?"Nature de recette":pretty(k)}</th>)}{active==="registrations"&&isSecretary&&<th>Actions</th>}{active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))&&<th>Actions</th>}{active==="justifications"&&(isSecretary||isAdmin)&&<th>Actions</th>}{active==="attendance"&&isSecretary&&<th>Régularisation</th>}</tr></thead><tbody>{filteredRows.map((row,i)=><tr className={["late","regularized","regularized_late"].includes(String(row.status??"").toLowerCase()) ? "late-row" : undefined} key={String(row.id??row.code??i)}>{Object.entries(row).filter(([k])=>k!=="id").map(([k,v])=><td key={k}>{["person_id","student_id","learner_id","staff_id","teacher_id"].includes(k)&&v!=null? (profileOptions.find(p=>p.id===String(v))?.display_name || [profileOptions.find(p=>p.id===String(v))?.first_name,profileOptions.find(p=>p.id===String(v))?.last_name].filter(Boolean).join(" ") || profileOptions.find(p=>p.id===String(v))?.public_id || "Nom et prénom à compléter"):k==="payment_category"?({"school_contribution":"Contribution scolaire","tuition":"Scolarité","registration_fee":"Frais d’inscription","training_fee":"Frais de formation","exam_fee":"Frais d’examen","document_sale":"Vente de documents","membership_fee":"Cotisation / adhésion","service_fee":"Prestation de service","equipment_fee":"Frais d’équipement","transport_fee":"Transport","penalty":"Pénalité","other":"Autre recette"} as Record<string,string>)[String(v)]||String(v):k==="status"&&v!=null?<span className={"pill "+statusClass(String(v))}>{pretty(String(v))}</span>:v==null?"—":typeof v==="boolean"?(v?"Oui":"Non"):typeof v==="object"?JSON.stringify(v):String(v).length>48?String(v).slice(0,45)+"…":String(v)}</td>)}{active==="registrations"&&isSecretary&&<td>{String(row.status)==="pending"?<><button className="btn btn-primary" disabled={busy} onClick={()=>void reviewRegistration(row,"approved")}>Valider</button> <button className="btn" disabled={busy} onClick={()=>void reviewRegistration(row,"rejected")}>Rejeter</button></>:String(row.status)==="approved"?<button className="btn btn-primary" disabled={busy||sendingWelcomeFor===String(row.person_id)} onClick={()=>void sendWelcomeEmail(row)}>{sendingWelcomeFor===String(row.person_id)?"Envoi…":"Envoyer le lien de connexion"}</button>:<span className="stat-foot">Aucune action</span>}</td>}{active==="justifications"&&(isSecretary||isAdmin)&&String(row.status)==="pending"&&<td><button className="btn btn-primary" disabled={busy} onClick={()=>void reviewAbsenceJustification(row,"approved")}>Approuver</button> <button className="btn" disabled={busy} onClick={()=>void reviewAbsenceJustification(row,"rejected")}>Rejeter</button></td>}{active==="payments"&&roles.some(role=>["ACCOUNTING","SECRETARIAT","DIRECTOR","PRE_ADMIN"].includes(role.code.toUpperCase()))&&<td>{String(row.status??"").toLowerCase() === "pending"?<button className="btn btn-primary" disabled={busy} onClick={()=>void validatePayment(row)}>Valider et générer le reçu</button>:row.receipt_number?<button className="btn" onClick={()=>{setReceiptPayment(row);printReceipt(row)}}>Voir / imprimer reçu</button>:<span className="stat-foot">Aucune action</span>}</td>}{active==="attendance"&&isSecretary&&<td>{String(row.status??"").toLowerCase()==="late"?<button className="btn btn-primary" disabled={busy} onClick={()=>void openAttendancePenalty(row)}>{busy?"Traitement…":row.penalty_id?"Régler le retard":"Créer la pénalité et régler"}</button>:<span className="stat-foot">Aucune action</span>}</td>}</tr>)}</tbody></table></div>}
          </div>
        </>}
        {active==="settings"&&<><div className="page-heading"><div><div className="eyebrow">SYSTÈME</div><h1 className="page-title">Paramètres du compte</h1><p className="page-subtitle">Consultez les informations de votre session et la configuration de sécurité.</p></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Profil connecté</div></div><div className="panel-body" style={{display:"grid",gap:18}}><div><div className="stat-foot">Nom affiché</div><div style={{fontWeight:700,marginTop:5}}>{fullName}</div></div><div><div className="stat-foot">E-mail</div><div style={{fontWeight:700,marginTop:5}}>{user.email}</div></div><div><div className="stat-foot">Rôles</div><div style={{marginTop:5}}>{roles.map(r=><span className="pill" key={r.code} style={{marginRight:6}}>{r.name}</span>)}</div></div><div><div className="stat-foot">Statut</div><div style={{marginTop:5}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"Non renseigné"}</span></div></div><button className="btn" style={{justifySelf:"start"}} onClick={handleSignOut}>Se déconnecter de cette session</button></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Sécurité et données</div></div><div className="panel-body" style={{fontSize:12,color:"#758396",lineHeight:1.8}}>La connexion est gérée par Supabase Auth. Les données sont chargées via les politiques de sécurité (RLS) configurées sur la base. Aucun secret de serveur n’est embarqué dans cette interface.</div></div></>}
        <div style={{textAlign:"center",fontSize:10,color:"#9aa6b5",padding:"12px 0 0"}}>AÉRO SERVICE · Plateforme de gestion · {new Date().getFullYear()}</div>
      </main>
    </section>
  </div>;
}
