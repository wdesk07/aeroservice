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
  { key: "teachers", label: "Formateurs", icon: "♧", table: "teachers", columns: ["id", "specialty", "status"], description: "Équipe pédagogique et affectations.", section: "PÉDAGOGIE" },
  { key: "formations", label: "Formations", icon: "✈", table: "formations", columns: ["code", "name", "duration", "status", "created_at"], description: "Catalogue des formations proposées.", section: "PÉDAGOGIE" },
  { key: "groups", label: "Groupes", icon: "▦", table: "groups", columns: ["code", "name", "academic_year", "capacity", "status"], description: "Organisation des groupes et promotions.", section: "PÉDAGOGIE" },
  { key: "subjects", label: "Matières", icon: "▤", table: "subjects", columns: ["code", "name", "formation_id", "status"], description: "Matières et unités d’enseignement.", section: "PÉDAGOGIE" },
  { key: "rooms", label: "Salles", icon: "⌂", table: "rooms", columns: ["code", "name", "capacity", "location_description", "status"], description: "Salles et espaces de formation.", section: "ORGANISATION" },
  { key: "registrations", label: "Inscriptions", icon: "▣", table: "registrations", columns: ["registration_number", "person_id", "formation_id", "registration_date", "status"], description: "Demandes d’inscription et admissions.", section: "ADMINISTRATION" },
  { key: "attendance", label: "Présences", icon: "◷", table: "attendance", columns: ["person_id", "session_id", "status", "check_in_at", "check_out_at"], description: "Pointage et suivi des présences.", section: "ADMINISTRATION" },
  { key: "payments", label: "Paiements", icon: "₣", table: "payments", columns: ["person_id", "amount", "currency", "payment_method", "status", "created_at"], description: "Suivi des règlements et frais.", section: "FINANCES" },
  { key: "staff", label: "Personnel", icon: "♙", table: "staff", columns: ["id", "department", "position", "status"], description: "Personnel administratif et opérationnel.", section: "ADMINISTRATION" },
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
const statusClass = (v: string) => ["active", "approved", "success", "validated", "present", "paid"].includes(v.toLowerCase()) ? "active" : ["pending", "submitted", "pre_review"].includes(v.toLowerCase()) ? "pending" : ["suspended", "rejected", "inactive", "absent"].includes(v.toLowerCase()) ? "rejected" : "";
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
    } else setRows((result.data ?? []) as Record<string, unknown>[]);
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
          <div className="page-heading"><div><div className="eyebrow">{activeModule.section}</div><h1 className="page-title">{activeModule.label}</h1><p className="page-subtitle">{activeModule.description}</p></div>{active==="formations"&&isAdmin&&<button className="btn btn-primary" onClick={()=>setShowCreate(!showCreate)}>{showCreate?"Fermer":"＋ Ajouter une formation"}</button>}</div>
          {active==="formations"&&showCreate&&isAdmin&&<div className="panel"><div className="panel-head"><div><div className="panel-title">Créer une formation</div><div className="panel-desc">Les champs code et nom sont obligatoires.</div></div></div><div className="panel-body"><form onSubmit={createFormation}><div className="form-grid"><label className="field">Code de la formation<input required value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="Ex. PILOTAGE-01"/></label><label className="field">Nom de la formation<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex. Initiation au pilotage"/></label><label className="field">Durée<input value={form.duration} onChange={e=>setForm({...form,duration:e.target.value})} placeholder="Ex. 6 mois"/></label><label className="field">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Présentation de la formation"/></label></div><div className="form-actions"><button type="button" className="btn" onClick={()=>setShowCreate(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?"Enregistrement…":"Enregistrer la formation"}</button></div></form></div></div>}
          <div className="panel"><div className="panel-head"><div><div className="panel-title">{activeModule.label} enregistrés</div><div className="panel-desc">Données affichées selon vos autorisations · maximum 100 lignes</div></div><div className="table-toolbar"><input className="search-box" placeholder="Rechercher dans les résultats…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn btn-quiet" onClick={()=>void loadRows(active)}>↻ Actualiser</button></div></div>
            {loading?<div className="loading">Chargement des données…</div>:filteredRows.length===0?<div className="empty-state"><div className="empty-icon">⌕</div><strong>{rows.length===0?"Aucune donnée à afficher":"Aucun résultat"}</strong><div style={{marginTop:7}}>{rows.length===0?"Ce module est vide ou les règles d’accès empêchent la lecture.":"Essayez avec un autre terme de recherche."}</div></div>:<div className="table-wrap"><table><thead><tr>{Object.keys(filteredRows[0]).map(k=><th key={k}>{pretty(k)}</th>)}</tr></thead><tbody>{filteredRows.map((row,i)=><tr key={String(row.id??row.code??i)}>{Object.entries(row).map(([k,v])=><td key={k}>{k==="status"&&v!=null?<span className={"pill "+statusClass(String(v))}>{pretty(String(v))}</span>:v==null?"—":typeof v==="boolean"?(v?"Oui":"Non"):typeof v==="object"?JSON.stringify(v):String(v).length>48?String(v).slice(0,45)+"…":String(v)}</td>)}</tr>)}</tbody></table></div>}
          </div>
        </>}
        {active==="settings"&&<><div className="page-heading"><div><div className="eyebrow">SYSTÈME</div><h1 className="page-title">Paramètres du compte</h1><p className="page-subtitle">Consultez les informations de votre session et la configuration de sécurité.</p></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Profil connecté</div></div><div className="panel-body" style={{display:"grid",gap:18}}><div><div className="stat-foot">Nom affiché</div><div style={{fontWeight:700,marginTop:5}}>{fullName}</div></div><div><div className="stat-foot">E-mail</div><div style={{fontWeight:700,marginTop:5}}>{user.email}</div></div><div><div className="stat-foot">Rôles</div><div style={{marginTop:5}}>{roles.map(r=><span className="pill" key={r.code} style={{marginRight:6}}>{r.name}</span>)}</div></div><div><div className="stat-foot">Statut</div><div style={{marginTop:5}}><span className={"pill "+statusClass(profile?.status||"")}>{profile?.status||"Non renseigné"}</span></div></div><button className="btn" style={{justifySelf:"start"}} onClick={handleSignOut}>Se déconnecter de cette session</button></div></div><div className="panel"><div className="panel-head"><div className="panel-title">Sécurité et données</div></div><div className="panel-body" style={{fontSize:12,color:"#758396",lineHeight:1.8}}>La connexion est gérée par Supabase Auth. Les données sont chargées via les politiques de sécurité (RLS) configurées sur la base. Aucun secret de serveur n’est embarqué dans cette interface.</div></div></>}
        <div style={{textAlign:"center",fontSize:10,color:"#9aa6b5",padding:"12px 0 0"}}>AÉRO SERVICE · Plateforme de gestion · {new Date().getFullYear()}</div>
      </main>
    </section>
  </div>;
}
