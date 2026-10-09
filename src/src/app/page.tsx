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
  { key: "registrations", label: "Inscriptions", icon: "▣", table: "registrations", columns: ["registration_number", "person_id", "formation_id", "group_id", "registration_date", "status"], description: "Demandes d’inscription et admissions.", section: "ADMINISTRATION" },
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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
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
  }, []);

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

  useEffect(() => { if (user && active !== "dashboard" && active !== "settings") void loadRows(active); }, [user, active, loadRows]);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) setError(authError.message);
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
    if (user && ["students", "registrations", "attendance"].includes(active)) {
      supabase.from("groups").select("id,name,code").order("name").then(({ data }) => setGroupOptions((data ?? []) as { id: string; name: string; code: string }[]));
      supabase.from("profiles").select("id,display_name,first_name,last_name,public_id").order("last_name").limit(300).then(({ data }) => setProfileOptions((data ?? []) as { id: string; display_name: string | null; first_name: string | null; last_name: string | null; public_id: string | null }[]));
      supabase.from("staff").select("id").then(({ data }) => setStaffIds((data ?? []).map((item: { id: string }) => item.id)));
    }
  }, [user, active]);

  async function createModuleRecord(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isAdmin || !createFields[active]) return;
    setBusy(true); setError(""); setNotice("");
    const payload: Record<string, unknown> = {};
    for (const field of createFields[active]) {
      const value = (createValues[field.name] ?? "").trim();
      if (active === "students" && field.name === "id") payload.id = value;
      else if (field.type === "number") payload[field.name] = value ? Number(value) : null;
      else payload[field.name] = value || null;
    }
    if (active === "registrations") { payload.created_by = user?.id; payload.submitted_at = new Date().toISOString(); }
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
    if (!user || !lateForm.person_id || Number(lateForm.amount_fcfa) <= 0) {
      setError("Choisissez un apprenant et saisissez un montant payé supérieur à zéro.");
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
      setNotice(`Retard enregistré : ${delayMinutes} minute(s). Paiement de ${amount.toLocaleString("fr-FR")} FCFA validé. Accès autorisé — dossier affiché en jaune.`);
      setLateForm({ person_type: "student", person_id: "", planned_time: "08:00", arrived_time: "", amount_fcfa: "", method: "cash", provider: "", transaction_reference: "", reason: "" });
    }
    await loadRows("attendance"); await loadCounts(); setBusy(false);
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

  if (!user) return <main className="login-screen">
    <section className="login-visual">
      <div className="brand"><div className="brand-mark">✈</div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Plateforme de gestion</div></div></div>
      <div className="login-visual-content"><div className="eyebrow" style={{color:"#9cc5ff"}}>FORMATION · ORGANISATION · SUIVI</div><h1>Prenez de la hauteur sur votre gestion.</h1><p>Un espace centralisé pour piloter les formations, suivre les apprenants et coordonner les opérations de votre établissement.</p><div className="login-bullets"><span>✦ Gestion pédagogique</span><span>✦ Suivi administratif</span><span>✦ Accès sécurisé</span></div></div>
      <div style={{fontSize:11,color:"#9db2c8",position:"relative",zIndex:1}}>© {new Date().getFullYear()} Aéro Service · Espace sécurisé</div>
    </section>
    <section className="login-form-side"><div className="login-card">
      <div className="brand" style={{padding:"0 0 30px"}}><div className="brand-mark" style={{background:"#eaf2ff",color:"#2474e5"}}>✈</div><div><div className="brand-name" style={{color:"#10243b"}}>AÉRO SERVICE</div><div className="brand-sub" style={{color:"#758396"}}>ESPACE DE CONNEXION</div></div></div>
      <h2>{mode === "login" ? "Bon retour parmi nous" : "Réinitialiser le mot de passe"}</h2><p>{mode === "login" ? "Connectez-vous pour accéder à votre espace de travail." : "Recevez un lien sécurisé par e-mail."}</p>
      {error && <div className="toast error-message">{error}</div>}{notice && <div className="toast">{notice}</div>}
      <form className="login-fields" onSubmit={mode === "login" ? handleLogin : handleReset}>
        <label className="field">Adresse e-mail<input type="email" autoComplete="email" placeholder="vous@exemple.com" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
        {mode === "login" && <label className="field">Mot de passe<input type="password" autoComplete="current-password" placeholder="Votre mot de passe" required value={password} onChange={e=>setPassword(e.target.value)} /></label>}
        <button className="btn btn-primary" style={{width:"100%",padding:13,marginTop:4}} disabled={busy}>{busy ? "Veuillez patienter…" : mode === "login" ? "Se connecter  →" : "Envoyer le lien"}</button>
      </form>
      <button className="link-btn" onClick={()=>{setMode(mode==="login"?"reset":"login");setError("");setNotice("");}}>{mode==="login"?"Mot de passe oublié ?":"← Retour à la connexion"}</button>
      <div className="login-foot">La connexion est sécurisée par Supabase Auth.<br/>L’accès aux données dépend de votre rôle et des règles de sécurité.</div>
    </div></section>
  </main>;

  return <div className="app-shell">
    <aside className={"sidebar" + (mobileNav ? " mobile-open" : "")}>
      <div className="brand"><div className="brand-mark">✈</div><div><div className="brand-name">AÉRO SERVICE</div><div className="brand-sub">Gestion & formation</div></div></div>
      {["PILOTAGE","PÉDAGOGIE","ORGANISATION","ADMINISTRATION","FINANCES","SYSTÈME"].map(section => <div key={section}><div className="nav-label">{section}</div>{modules.filter(m=>m.section===section).map(m=><button key={m.key} className={"nav-item"+(active===m.key?" active":"")} onClick={()=>{setActive(m.key);setSearch("");setShowCreate(false);setMobileNav(false);setNotice("");setError("");}}><span className="nav-icon">{m.icon}</span>{m.label}</button>)}</div>)}
      <div className="sidebar-bottom"><div className="sidebar-note">Espace de travail sécurisé<br/>Aéro Service · Gestion intégrée</div></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div style={{display:"flex",alignItems:"center",gap:12}}><button className="btn mobile-menu" onClick={()=>setMobileNav(!mobileNav)}>☰</button><div><div className="breadcrumb">Aéro Service / {activeModule.label}</div><div className="topbar-title">{activeModule.label}</div></div></div><div className="top-actions"><button className="icon-btn" title="Actualiser" onClick={()=>{void loadCounts();if(active!=="dashboard"&&active!=="settings")void loadRows(active);}}>↻</button><div className="user-chip"><div className="avatar">{initials(fullName)}</div><div className="user-meta"><div className="user-name">{fullName}</div><div className="user-role">{roles.map(r=>r.name).join(" · ")||"Compte connecté"}</div></div></div><button className="btn" onClick={handleSignOut}>Déconnexion</button></div></header>
      <main className="content">
        {error && <div className="toast error-message">{error}</div>}{notice && <div className="toast">{notice}</div>}
        {active==="dashboard" && <>
          <div className="page-heading"><div><div className="eyebrow">TABLEAU DE BORD</div><h1 className="page-title">Bonjour {fullName.split(" ")[0]} 👋</h1><p className="page-subtitle">Voici l’état de votre espace de gestion aujourd’hui.</p></div><button className="btn btn-primary" onClick={()=>{setActive("formations");setShowCreate(true);}}>＋ Nouvelle formation</button></div>
          <div className="stats-grid">{metrics.map((metric,i)=><div className="stat-card" key={metric.table}><div className="stat-top"><span>{metric.label}</span><span className="stat-icon">{metric.icon}</span></div><div className="stat-number">{counts[metric.table]===undefined?"…":counts[metric.table]===null?"—":counts[metric.table]}</div><div className="stat-foot">{metric.foot}</div></div>)}</div>
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Accès rapide</div><div className="panel-desc">Retrouvez les espaces de travail les plus utilisés.</div></div></div><div className="panel-body"><div className="quick-grid">{[
            {key:"students" as ModuleKey,icon:"♙",title:"Gérer les apprenants",desc:"Consulter les dossiers et parcours"},
            {key:"formations" as ModuleKey,icon:"✈",title:"Catalogue des formations",desc:"Organiser l’offre pédagogique"},
            {key:"registrations" as ModuleKey,icon:"▣",title:"Suivre les inscriptions",desc:"Voir les demandes enregistrées"},
            {key:"attendance" as ModuleKey,icon:"◷",title:"Présences & pointage",desc:"Consulter les feuilles de présence"},
            {key:"payments" as ModuleKey,icon:"₣",title:"Suivi des paiements",desc:"Consulter les règlements"},
            {key:"roles" as ModuleKey,icon:"⚿",title:"Rôles & autorisations",desc:"Consulter les rôles configurés"}
          ].map(q=><button className="quick-action" key={q.key} onClick={()=>{setActive(q.key);setSearch("");setError("");}}><span className="quick-icon">{q.icon}</span><span><div className="quick-title">{q.title}</div><div className="quick-desc">{q.desc}</div></span><span style={{marginLeft:"auto",color:"#9aa8b8"}}>→</span></button>)}</div></div></div>
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Votre session</div><div className="panel-desc">Informations du compte actuellement connecté.</div></div><span className="pill active">● Connecté</span></div><div className="panel-body" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:20}}><div><div className="stat-foot">Adresse e-mail</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{user.email}</div></div><div><div className="stat-foot">Identifiant public</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{profile?.public_id||"Non renseigné"}</div></div><div><div className="stat-foot">Rôles attribués</div><div style={{fontSize:13,fontWeight:700,marginTop:7}}>{roles.map(r=>r.name).join(", ")||"Aucun rôle chargé"}</div></div><div><div className="stat-foot">Statut du profil</div><div style={{marginTop:7}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"À vérifier"}</span></div></div></div></div>
        </>}
        {active!=="dashboard" && active!=="settings" && <>
          <div className="page-heading"><div><div className="eyebrow">{activeModule.section}</div><h1 className="page-title">{activeModule.label}</h1><p className="page-subtitle">{active === "attendance" ? "Enregistrez le retard, validez le montant payé et autorisez l’accès à l’apprenant." : activeModule.description}</p></div>{(["formations","students","registrations","groups","subjects","rooms"].includes(active)&&isAdmin)&&<button className="btn btn-primary" onClick={()=>setShowCreate(!showCreate)}>{showCreate?"Fermer":active==="formations"?"＋ Ajouter une formation":active==="students"?"＋ Ajouter un dossier":active==="registrations"?"＋ Nouvelle inscription":active==="groups"?"＋ Ajouter un groupe":active==="subjects"?"＋ Ajouter une matière":"＋ Ajouter une salle"}</button>}</div>
          {active === "attendance" && isSecretary && <div className="panel late-panel"><div className="panel-head"><div><div className="panel-title">Retard et autorisation d’accès</div><div className="panel-desc">Pour les apprenants et le personnel. Le DG et l’administration retrouvent les retards et paiements validés.</div></div><span className="pill late-status">● Validation secrétaire</span></div><div className="panel-body"><form onSubmit={registerLateArrival}><div className="form-grid"><label className="field">Catégorie<select required value={lateForm.person_type} onChange={e=>setLateForm({...lateForm,person_type:e.target.value,person_id:""})}><option value="student">Apprenant</option><option value="staff">Personnel</option></select></label><label className="field">{lateForm.person_type === "staff" ? "Membre du personnel" : "Apprenant"}<select required value={lateForm.person_id} onChange={e=>setLateForm({...lateForm,person_id:e.target.value})}><option value="">Rechercher / choisir une personne</option>{profileOptions.filter(item=>lateForm.person_type !== "staff" || staffIds.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.public_id ? item.public_id + " — " : ""}{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(" ")||item.id}</option>)}</select></label><label className="field">Heure normale d’arrivée<input type="time" required value={lateForm.planned_time} onChange={e=>setLateForm({...lateForm,planned_time:e.target.value})}/></label><label className="field">Heure d’arrivée constatée<input type="time" value={lateForm.arrived_time} onChange={e=>setLateForm({...lateForm,arrived_time:e.target.value})} /></label><label className="field">Montant payé (FCFA)<input type="number" min="1" step="1" required value={lateForm.amount_fcfa} onChange={e=>setLateForm({...lateForm,amount_fcfa:e.target.value})} placeholder="Ex. 1000"/></label><label className="field">Mode de paiement<select required value={lateForm.method} onChange={e=>setLateForm({...lateForm,method:e.target.value})}><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="other">Autre</option></select></label><label className="field">Opérateur (facultatif)<input value={lateForm.provider} onChange={e=>setLateForm({...lateForm,provider:e.target.value})} placeholder="Ex. MTN, Moov…"/></label><label className="field">Référence du paiement (facultatif)<input value={lateForm.transaction_reference} onChange={e=>setLateForm({...lateForm,transaction_reference:e.target.value})} placeholder="Référence ou numéro de reçu"/></label><label className="field">Motif / observation (facultatif)<input value={lateForm.reason} onChange={e=>setLateForm({...lateForm,reason:e.target.value})} placeholder="Ex. transport, circulation…"/></label></div><div className="late-preview"><span className="late-dot"></span><div><strong>Après validation réussie</strong><p>Le statut devient « Retard régularisé », la ligne apparaît en jaune et l’accès est autorisé. Le montant est conservé dans le suivi des paiements.</p></div></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setLateForm({person_type:"student",person_id:"",planned_time:"08:00",arrived_time:"",amount_fcfa:"",method:"cash",provider:"",transaction_reference:"",reason:""})}>Effacer</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Validation en cours…":"Valider le paiement et autoriser l’accès"}</button></div></form></div></div>}
          {active!=="formations"&&showCreate&&isAdmin&&createFields[active]&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer un enregistrement</div><div className="panel-desc">Les données seront enregistrées dans la base existante, selon les autorisations Supabase.</div></div></div><div className="panel-body"><form onSubmit={createModuleRecord}><div className="form-grid">{createFields[active].map(field=><label className="field" key={field.name}>{field.label}{field.type==="formation"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une formation</option>{formationOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="group"?<select value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir un groupe</option>{groupOptions.map(item=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>:field.type==="profile"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir une personne</option>{profileOptions.map(item=><option key={item.id} value={item.id}>{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(" ")||item.public_id||item.id}</option>)}</select>:field.type==="select"?<select required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})}><option value="">Choisir…</option>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input type={field.type??"text"} min={field.type==="number"?0:undefined} required={field.required} value={createValues[field.name]??""} onChange={e=>setCreateValues({...createValues,[field.name]:e.target.value})} placeholder={field.type==="number"?"0":field.label}/>}</label>)}</div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":"Enregistrer"}</button></div></form></div></div>}
          {active==="formations"&&showCreate&&isAdmin&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer une formation</div><div className="panel-desc">Les champs code et nom sont obligatoires.</div></div></div><div className="panel-body"><form onSubmit={createFormation}><div className="form-grid"><label className="field">Code de la formation<input required value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="Ex. PILOTAGE-01"/></label><label className="field">Nom de la formation<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex. Initiation au pilotage"/></label><label className="field">Durée<input value={form.duration} onChange={e=>setForm({...form,duration:e.target.value})} placeholder="Ex. 6 mois"/></label><label className="field">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Présentation de la formation"/></label></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":"Enregistrer la formation"}</button></div></form></div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">{activeModule.label} enregistrés</div><div className="panel-desc">Données affichées selon vos autorisations · maximum 100 lignes</div></div><div className="table-toolbar"><input className="search-box" placeholder="Rechercher dans les résultats…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn btn-quiet" onClick={()=>void loadRows(active)}>↻ Actualiser</button></div></div>
            {loading?<div className="loading">Chargement des données…</div>:filteredRows.length===0?<div className="empty-state"><div className="empty-icon">⌕</div><strong>{rows.length===0?"Aucune donnée à afficher":"Aucun résultat"}</strong><div style={{marginTop:7}}>{rows.length===0?"Ce module est vide ou les règles d’accès empêchent la lecture.":"Essayez avec un autre terme de recherche."}</div></div>:<div className="table-wrap"><table><thead><tr>{Object.keys(filteredRows[0]).map(k=><th key={k}>{pretty(k)}</th>)}</tr></thead><tbody>{filteredRows.map((row,i)=><tr className={String(row.status??"")==="regularized_late" ? "late-row" : undefined} key={String(row.id??row.code??i)}>{Object.entries(row).map(([k,v])=><td key={k}>{k==="status"&&v!=null?<span className={"pill "+statusClass(String(v))}>{pretty(String(v))}</span>:v==null?"—":typeof v==="boolean"?(v?"Oui":"Non"):typeof v==="object"?JSON.stringify(v):String(v).length>48?String(v).slice(0,45)+"…":String(v)}</td>)}</tr>)}</tbody></table></div>}
          </div>
        </>}
        {active==="settings"&&<><div className="page-heading"><div><div className="eyebrow">SYSTÈME</div><h1 className="page-title">Paramètres du compte</h1><p className="page-subtitle">Consultez les informations de votre session et la configuration de sécurité.</p></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Profil connecté</div></div><div className="panel-body" style={{display:"grid",gap:18}}><div><div className="stat-foot">Nom affiché</div><div style={{fontWeight:700,marginTop:5}}>{fullName}</div></div><div><div className="stat-foot">E-mail</div><div style={{fontWeight:700,marginTop:5}}>{user.email}</div></div><div><div className="stat-foot">Rôles</div><div style={{marginTop:5}}>{roles.map(r=><span className="pill" key={r.code} style={{marginRight:6}}>{r.name}</span>)}</div></div><div><div className="stat-foot">Statut</div><div style={{marginTop:5}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"Non renseigné"}</span></div></div><button className="btn" style={{justifySelf:"start"}} onClick={handleSignOut}>Se déconnecter de cette session</button></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Sécurité et données</div></div><div className="panel-body" style={{fontSize:12,color:"#758396",lineHeight:1.8}}>La connexion est gérée par Supabase Auth. Les données sont chargées via les politiques de sécurité (RLS) configurées sur la base. Aucun secret de serveur n’est embarqué dans cette interface.</div></div></>}
        <div style={{textAlign:"center",fontSize:10,color:"#9aa6b5",padding:"12px 0 0"}}>AÉRO SERVICE · Plateforme de gestion · {new Date().getFullYear()}</div>
      </main>
    </section>
  </div>;
}
