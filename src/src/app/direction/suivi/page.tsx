"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Attendance = {
  id: string;
  person_id: string;
  person_type: string;
  local_date: string;
  nominal_time: string;
  cutoff_time: string;
  arrived_at: string | null;
  status: string;
  minutes_after_cutoff: number;
};
type Profile = { id: string; display_name: string | null; first_name: string | null; last_name: string | null; email: string | null };

const directorRoles = ["DIRECTOR", "ADMIN", "PRE_ADMIN"];

function localDateString(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const pick = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
function fullName(profile?: Profile) {
  if (!profile) return "Nom à compléter";
  return profile.display_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Nom à compléter";
}
function statusLabel(status: string) {
  const value = status.toLowerCase();
  if (["on_time", "present", "regularized", "regularized_late"].includes(value)) return "À l’heure / régularisé";
  if (value === "late") return "En retard";
  if (value === "absent") return "Absent";
  return status;
}
function minutesLabel(value: number) { return value > 0 ? `${value} min` : "—"; }

export default function DirectionSuiviPage() {
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [rows, setRows] = useState<Attendance[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [day, setDay] = useState(localDateString(new Date()));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) { setAuthorized(false); setReady(true); setBusy(false); return; }
    const { data: roleRows, error: roleError } = await supabase.from("user_roles").select("roles(code)").eq("user_id", user.id);
    const codes = (roleRows ?? []).flatMap((item: any) => Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []).map((role: any) => String(role.code).toUpperCase());
    if (roleError || !codes.some((code: string) => directorRoles.includes(code))) {
      setAuthorized(false); setReady(true); setBusy(false); return;
    }
    setAuthorized(true); setReady(true);
    const selected = new Date(`${day}T12:00:00+01:00`);
    const endDate = new Date(selected);
    const startDate = new Date(selected);
    if (period === "week") {
      const weekday = (selected.getUTCDay() + 6) % 7;
      startDate.setUTCDate(startDate.getUTCDate() - weekday);
      endDate.setUTCDate(startDate.getUTCDate() + 6);
    }
    const start = localDateString(startDate);
    const end = localDateString(endDate);
    const { data, error: attendanceError } = await supabase.from("daily_attendance")
      .select("id,person_id,person_type,local_date,nominal_time,cutoff_time,arrived_at,status,minutes_after_cutoff")
      .gte("local_date", start).lte("local_date", end).order("local_date", { ascending: false }).order("arrived_at", { ascending: false }).limit(2000);
    if (attendanceError) {
      setRows([]); setError("Impossible de charger les pointages. Vérifiez les autorisations de lecture de la Direction dans Supabase. " + attendanceError.message);
      setBusy(false); return;
    }
    const attendance = (data ?? []) as Attendance[];
    setRows(attendance);
    const ids = [...new Set(attendance.map((row) => row.person_id))];
    if (ids.length) {
      const { data: profileRows, error: profileError } = await supabase.from("profiles").select("id,display_name,first_name,last_name,email").in("id", ids);
      if (profileError) setError("Les pointages sont chargés, mais les noms ne sont pas tous accessibles. Vérifiez les autorisations de lecture des profils.");
      const map: Record<string, Profile> = {};
      for (const p of (profileRows ?? []) as Profile[]) map[p.id] = p;
      setProfiles(map);
    } else setProfiles({});
    setBusy(false);
  }, [day, period]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    checkins: rows.length,
    late: rows.filter((row) => row.status.toLowerCase() === "late").length,
    absent: rows.filter((row) => row.status.toLowerCase() === "absent").length,
    staff: rows.filter((row) => ["staff", "personnel"].includes(row.person_type.toLowerCase())).length,
    students: rows.filter((row) => ["student", "apprenant"].includes(row.person_type.toLowerCase())).length
  }), [rows]);
  const ranking = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; count: number; minutes: number }>();
    for (const row of rows) {
      if (row.status.toLowerCase() !== "late") continue;
      const p = profiles[row.person_id];
      const current = grouped.get(row.person_id) ?? { id: row.person_id, name: fullName(p), count: 0, minutes: 0 };
      current.count += 1; current.minutes += Number(row.minutes_after_cutoff || 0);
      grouped.set(row.person_id, current);
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes || a.name.localeCompare(b.name));
  }, [rows, profiles]);

  if (!ready || busy) return <main style={styles.page}><section style={styles.card}>Chargement sécurisé du suivi de présence…</section></main>;
  if (!authorized) return <main style={styles.page}><section style={styles.card}><img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 100, height: 70, objectFit: "contain" }} /><h1>Suivi réservé à la Direction</h1><p>Connectez-vous avec un compte Direction, ADMIN ou PRE_ADMIN pour consulter les rapports.</p><a href="/">Retour à Aéro Service</a></section></main>;

  return <main style={styles.page}>
    <header style={styles.header}>
      <div><img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 74, height: 54, objectFit: "contain" }} /><div style={styles.eyebrow}>DIRECTION · CONTRÔLE DES PRÉSENCES</div><h1 style={{ margin: "6px 0" }}>Suivi du personnel et des apprenants</h1><p style={styles.muted}>Les noms affichés proviennent des profils enregistrés. Les absences comptabilisées sont celles enregistrées dans la base.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><a href="/" style={styles.link}>← Espace principal</a><button style={styles.button} onClick={() => void load()}>Actualiser</button></div>
    </header>
    <section style={styles.toolbar}>
      <label style={styles.label}>Période<select value={period} onChange={(e) => setPeriod(e.target.value as "day" | "week")} style={styles.input}><option value="day">Bilan quotidien</option><option value="week">Bilan hebdomadaire (lundi–dimanche)</option></select></label>
      <label style={styles.label}>Date de référence<input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={styles.input} /></label>
      <div style={styles.note}>Personnel : heure de référence 08:30 · tolérance 10 minutes. Le pointage tardif reste dans l’historique même après paiement.</div>
    </section>
    {error && <div style={styles.error}>{error}</div>}
    <section style={styles.stats}>
      {[["Pointages enregistrés", totals.checkins], ["Retards enregistrés", totals.late], ["Absences enregistrées", totals.absent], ["Personnel", totals.staff], ["Apprenants", totals.students]].map(([label, value]) => <div key={String(label)} style={styles.stat}><div style={styles.muted}>{label}</div><strong style={{ fontSize: 28 }}>{value}</strong></div>)}
    </section>
    <section style={styles.card}>
      <h2 style={styles.h2}>Personnes les plus souvent en retard</h2>
      {ranking.length === 0 ? <p style={styles.muted}>Aucun retard enregistré sur cette période.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Rang</th><th>Nom et prénom</th><th>Catégorie</th><th>Nombre de retards</th><th>Minutes de retard cumulées</th></tr></thead><tbody>{ranking.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><strong>{item.name}</strong></td><td>{rows.find((row) => row.person_id === item.id)?.person_type === "staff" ? "Personnel" : "Apprenant"}</td><td>{item.count}</td><td>{item.minutes} min</td></tr>)}</tbody></table></div>}
    </section>
    <section style={styles.card}>
      <h2 style={styles.h2}>Détail des pointages</h2>
      {rows.length === 0 ? <p style={styles.muted}>Aucun pointage enregistré pour cette période.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Date</th><th>Nom et prénom</th><th>Catégorie</th><th>Heure prévue</th><th>Heure de pointage</th><th>Statut</th><th>Retard</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.local_date}</td><td><strong>{fullName(profiles[row.person_id])}</strong></td><td>{["staff", "personnel"].includes(row.person_type.toLowerCase()) ? "Personnel" : "Apprenant"}</td><td>{row.nominal_time?.slice(0, 5) || "—"}</td><td>{row.arrived_at ? new Date(row.arrived_at).toLocaleTimeString("fr-FR", { timeZone: "Africa/Porto-Novo", hour: "2-digit", minute: "2-digit" }) : "—"}</td><td><span style={{ ...styles.status, ...(row.status.toLowerCase() === "late" ? styles.late : row.status.toLowerCase() === "absent" ? styles.absent : styles.ontime) }}>{statusLabel(row.status)}</span></td><td>{minutesLabel(row.minutes_after_cutoff)}</td></tr>)}</tbody></table></div>}
    </section>
    <p style={styles.footer}>Aéro Service · Rapport calculé à partir des pointages présents dans la base de données.</p>
  </main>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: 24, background: "#f3f6fa", color: "#16253b", fontFamily: "Arial,sans-serif" },
  header: { maxWidth: 1180, margin: "0 auto 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" },
  eyebrow: { color: "#48617f", fontSize: 12, fontWeight: 800, letterSpacing: 1.4 },
  muted: { color: "#63738a", fontSize: 14, lineHeight: 1.5 },
  card: { maxWidth: 1180, margin: "0 auto 18px", padding: 20, border: "1px solid #dce4ef", borderRadius: 16, background: "#fff", boxShadow: "0 4px 18px rgba(20,42,70,.04)" },
  toolbar: { maxWidth: 1180, margin: "0 auto 18px", padding: 18, border: "1px solid #dce4ef", borderRadius: 16, background: "#fff", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "end" },
  label: { display: "grid", gap: 6, fontSize: 13, fontWeight: 700, minWidth: 220 },
  input: { padding: "10px 12px", border: "1px solid #cdd8e5", borderRadius: 9, background: "#fff", color: "#16253b", fontSize: 14 },
  note: { color: "#53657c", fontSize: 13, flex: 1, minWidth: 260, lineHeight: 1.5 },
  stats: { maxWidth: 1180, margin: "0 auto 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 12 },
  stat: { padding: 18, border: "1px solid #dce4ef", borderRadius: 14, background: "#fff", display: "grid", gap: 8 },
  h2: { fontSize: 18, margin: "0 0 14px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 },
  button: { border: 0, borderRadius: 9, padding: "10px 14px", background: "#174ea6", color: "#fff", fontWeight: 700, cursor: "pointer" },
  link: { alignSelf: "center", padding: "10px 12px", border: "1px solid #cdd8e5", borderRadius: 9, color: "#174ea6", fontWeight: 700, textDecoration: "none" },
  error: { maxWidth: 1180, margin: "0 auto 18px", padding: 14, borderRadius: 10, background: "#fff0f0", color: "#922", border: "1px solid #f2c7c7" },
  status: { display: "inline-block", borderRadius: 999, padding: "5px 9px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" },
  late: { background: "#fff0f0", color: "#9a2727" },
  absent: { background: "#fff0d8", color: "#80500a" },
  ontime: { background: "#e8f7ed", color: "#17633a" },
  footer: { maxWidth: 1180, margin: "0 auto", color: "#63738a", fontSize: 12 }
};
