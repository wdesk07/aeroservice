"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Formation = { id: string; name: string };
type Suspension = {
  id: string;
  formation_id: string | null;
  starts_on: string;
  ends_on: string;
  reason: string;
  created_at: string;
  revoked_at: string | null;
};

function todayLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export default function CourseSuspensionsPage() {
  const [formations, setFormations] = useState<Formation[]>([]);
  const [items, setItems] = useState<Suspension[]>([]);
  const [formationId, setFormationId] = useState("");
  const [startsOn, setStartsOn] = useState(todayLocal());
  const [endsOn, setEndsOn] = useState(todayLocal());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [authorized, setAuthorized] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const { data: auth } = await supabase.auth.getSession();
    const user = auth.session?.user;
    if (!user) { setAuthorized(false); setBusy(false); return; }
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles").select("roles(code)").eq("user_id", user.id);
    const roles = (roleRows ?? []).flatMap((item: any) =>
      Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []
    ).map((role: any) => String(role.code ?? "").toUpperCase());
    if (roleError || !roles.some((role: string) => ["DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(role))) {
      setAuthorized(false); setBusy(false); return;
    }
    setAuthorized(true);
    const [{ data: formationRows, error: formationError }, { data: suspensionRows, error: suspensionError }] = await Promise.all([
      supabase.from("formations").select("id,name").eq("status", "active").order("name"),
      supabase.from("course_suspensions").select("id,formation_id,starts_on,ends_on,reason,created_at,revoked_at").order("created_at", { ascending: false }).limit(100)
    ]);
    if (formationError || suspensionError) setError("Impossible de charger les formations ou l'historique des suspensions : " + (formationError?.message || suspensionError?.message));
    setFormations((formationRows ?? []) as Formation[]);
    setItems((suspensionRows ?? []) as Suspension[]);
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!reason.trim()) { setError("Indique le motif de la suspension."); return; }
    if (!startsOn || !endsOn || endsOn < startsOn) { setError("Vérifie les dates de début et de fin."); return; }
    setSaving(true); setError("");
    const { error: rpcError } = await supabase.rpc("record_course_suspension", {
      p_formation_id: formationId || null,
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_reason: reason.trim()
    });
    if (rpcError) setError("La suspension n'a pas été enregistrée : " + rpcError.message);
    else { setReason(""); await load(); }
    setSaving(false);
  }

  async function restore(id: string) {
    if (!window.confirm("Rétablir cette suspension ? Les séances concernées qui n'étaient annulées que pour cette suspension seront réactivées.")) return;
    setError("");
    const { error: rpcError } = await supabase.rpc("revoke_course_suspension", { p_suspension_id: id });
    if (rpcError) setError("Impossible de rétablir les cours : " + rpcError.message);
    else await load();
  }

  if (busy) return <main style={styles.page}><section style={styles.card}>Chargement de l'Agenda…</section></main>;
  if (!authorized) return <main style={styles.page}><section style={styles.card}><h1>Accès réservé à la Direction</h1><p>Connecte-toi avec un compte Direction, ADMIN ou PRE_ADMIN.</p><a href="/">Retour à l'accueil</a></section></main>;

  const formationName = (id: string | null) => id ? formations.find((f) => f.id === id)?.name ?? "Formation" : "Toutes les formations";

  return <main style={styles.page}>
    <header style={styles.header}>
      <div><div style={styles.eyebrow}>AÉRO SERVICE · AGENDA</div><h1 style={{ margin: "6px 0" }}>Suspension des cours</h1><p style={styles.muted}>Enregistre une décision de la Direction pour éviter que les apprenants soient déclarés absents lorsque les cours sont suspendus.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><a style={styles.link} href="/">Accueil</a><a style={styles.link} href="/direction/suivi/apprenants">Suivi des présences</a></div>
    </header>

    <section style={styles.card}>
      <h2 style={styles.h2}>Enregistrer une suspension</h2>
      <div style={styles.form}>
        <label style={styles.label}>Formations concernées
          <select value={formationId} onChange={(e) => setFormationId(e.target.value)} style={styles.input}>
            <option value="">Toutes les formations</option>
            {formations.map((formation) => <option key={formation.id} value={formation.id}>{formation.name}</option>)}
          </select>
        </label>
        <label style={styles.label}>Date de début<input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} style={styles.input} /></label>
        <label style={styles.label}>Date de fin<input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} style={styles.input} /></label>
        <label style={{ ...styles.label, gridColumn: "1 / -1" }}>Motif<textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : décision de la Direction — apprenants invités à rester à la maison." rows={3} style={styles.input} /></label>
      </div>
      <p style={styles.muted}>Les séances restent conservées dans l'historique. Aucune absence ni pénalité d'absence ne sera attribuée aux apprenants concernés pendant cette période.</p>
      {error && <div style={styles.error}>{error}</div>}
      <button disabled={saving} onClick={() => void submit()} style={{ ...styles.button, opacity: saving ? .6 : 1 }}>{saving ? "Enregistrement…" : "Enregistrer la suspension"}</button>
    </section>

    <section style={styles.card}>
      <h2 style={styles.h2}>Historique des suspensions</h2>
      {items.length === 0 ? <p style={styles.muted}>Aucune suspension enregistrée.</p> : <div style={{ overflowX: "auto" }}>
        <table style={styles.table}><thead><tr><th>Formations</th><th>Période</th><th>Motif</th><th>Enregistrée le</th><th>État</th><th>Action</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>
            <td>{formationName(item.formation_id)}</td><td>{item.starts_on} → {item.ends_on}</td><td>{item.reason}</td>
            <td>{new Date(item.created_at).toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo" })}</td>
            <td>{item.revoked_at ? "Rétablie" : "Active / période enregistrée"}</td>
            <td>{!item.revoked_at && <button style={styles.smallButton} onClick={() => void restore(item.id)}>Rétablir</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </main>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: 24, background: "#f3f6fa", color: "#16253b", fontFamily: "Arial,sans-serif" },
  header: { maxWidth: 1180, margin: "0 auto 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" },
  eyebrow: { color: "#48617f", fontSize: 12, fontWeight: 800, letterSpacing: 1.4 },
  muted: { color: "#63738a", fontSize: 14, lineHeight: 1.5 },
  card: { maxWidth: 1180, margin: "0 auto 18px", padding: 20, border: "1px solid #dce4ef", borderRadius: 16, background: "#fff" },
  h2: { fontSize: 18, margin: "0 0 14px" },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 },
  label: { display: "grid", gap: 6, fontSize: 13, fontWeight: 700 },
  input: { padding: "10px 12px", border: "1px solid #cdd8e5", borderRadius: 9, background: "#fff", color: "#16253b", fontSize: 14, width: "100%", boxSizing: "border-box" },
  button: { border: 0, borderRadius: 9, padding: "11px 16px", background: "#174ea6", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 8 },
  smallButton: { border: 0, borderRadius: 8, padding: "8px 10px", background: "#e8f0fc", color: "#174ea6", fontWeight: 700, cursor: "pointer" },
  link: { padding: "10px 12px", border: "1px solid #cdd8e5", borderRadius: 9, color: "#174ea6", fontWeight: 700, textDecoration: "none" },
  error: { margin: "12px 0", padding: 12, borderRadius: 9, background: "#fff0f0", color: "#922" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 850 }
};
