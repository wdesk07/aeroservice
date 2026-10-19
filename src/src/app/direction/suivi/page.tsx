"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
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
type Profile = { id: string; display_name: string | null; first_name: string | null; last_name: string | null; email: string | null; status?: string | null };
type Formation = { id: string; name: string; code: string | null };
type SessionAttendance = { id: string; person_id: string; display_name: string | null; first_name: string | null; last_name: string | null; student_number: string | null; session_id: string; session_date: string; formation_name: string | null; planned_start: string; planned_end: string; status: string; arrived_at: string | null; nominal_time: string; cutoff_time: string; minutes_after_cutoff: number; daily_attendance_id: string | null };
type Justification = { id: string; person_id: string; attendance_id: string | null; reason_type: string | null; reason: string | null; document_url: string | null; submitted_at: string; status: string; reviewed_at: string | null; review_comment: string | null };

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
  const pathname = usePathname();
  const isStaffView = pathname.endsWith("/personnel");
  const isStudentView = pathname.endsWith("/apprenants");
  const isChooser = pathname === "/direction/suivi" || pathname === "/direction/suivi/";
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [rows, setRows] = useState<Attendance[]>([]);
  const [sessionRows, setSessionRows] = useState<SessionAttendance[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [formations, setFormations] = useState<Formation[]>([]);
  const [studentFormationNames, setStudentFormationNames] = useState<Record<string, string>>({});
  const [justifications, setJustifications] = useState<Justification[]>([]);
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [day, setDay] = useState(localDateString(new Date()));
  const [formationFilter, setFormationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "present" | "late" | "absent" | "regularized" | "upcoming">("all");
  const [personTypeFilter, setPersonTypeFilter] = useState<"all" | "student" | "staff">("all");
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
    // Actualise le détail par séance à partir du pointage journalier unique.
    const refreshDates: string[] = [];
    const cursor = new Date(`${start}T12:00:00+01:00`);
    const last = new Date(`${end}T12:00:00+01:00`);
    while (cursor <= last) { refreshDates.push(localDateString(cursor)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    for (const date of refreshDates) {
      const { error: materializeError } = await supabase.rpc("materialize_formation_sessions_for_date", { p_date: date });
      if (materializeError) { setError("Le planning hebdomadaire n’a pas pu être généré : " + materializeError.message); }
      const { error: refreshError } = await supabase.rpc("refresh_session_attendance_for_date", { p_date: date });
      if (refreshError) { setError("Le détail par séance n’a pas pu être actualisé : " + refreshError.message); }
    }
    const [{ data, error: attendanceError }, { data: perSession, error: sessionError }, { data: formationRows, error: formationsError }, { data: studentRows, error: studentsError }, { data: justificationRows, error: justificationError }] = await Promise.all([
      supabase.from("daily_attendance")
        .select("id,person_id,person_type,local_date,nominal_time,cutoff_time,arrived_at,status,minutes_after_cutoff")
        .gte("local_date", start).lte("local_date", end).order("local_date", { ascending: false }).order("arrived_at", { ascending: false }).limit(2000),
      supabase.from("director_session_attendance")
        .select("id,person_id,display_name,first_name,last_name,student_number,session_id,session_date,formation_name,planned_start,planned_end,status,arrived_at,nominal_time,cutoff_time,minutes_after_cutoff,daily_attendance_id")
        .gte("session_date", start).lte("session_date", end).order("session_date", { ascending: false }).order("planned_start", { ascending: true }).limit(4000),
      supabase.from("formations").select("id,name,code").eq("status","active").order("name"),
      supabase.from("students").select("id,formation_id").limit(5000),
      supabase.from("absence_justifications").select("id,person_id,attendance_id,reason_type,reason,document_url,submitted_at,status,reviewed_at,review_comment").order("submitted_at", { ascending: false }).limit(2000)
    ]);
    setJustifications((justificationRows ?? []) as Justification[]);
    if (justificationError) setError("Les présences sont chargées, mais les justifications ne sont pas accessibles avec les autorisations actuelles.");
    setFormations((formationRows ?? []) as Formation[]);
    if (formationsError || studentsError) setError("Le catalogue des formations ou les inscriptions ne sont pas entièrement accessibles ; les filtres peuvent être incomplets.");
    if (sessionError) setError("Le rapport général est chargé, mais le détail par séance est inaccessible : " + sessionError.message);
    setSessionRows((perSession ?? []) as SessionAttendance[]);
    if (attendanceError) {
      setRows([]); setError("Impossible de charger les pointages. Vérifiez les autorisations de lecture de la Direction dans Supabase. " + attendanceError.message);
      setBusy(false); return;
    }
    let attendance = (data ?? []) as Attendance[];
    const [{ data: profileRows, error: profileError }, { data: allRoleRows, error: allRolesError }] = await Promise.all([
      supabase.from("profiles").select("id,display_name,first_name,last_name,email,status"),
      supabase.from("user_roles").select("user_id,roles(code)")
    ]);
    const map: Record<string, Profile> = {};
    for (const p of (profileRows ?? []) as Profile[]) map[p.id] = p;
    if (profileError || allRolesError) {
      setError("Les pointages sont chargés, mais les noms ou la liste des personnes actives ne sont pas tous accessibles. Vérifiez les autorisations de lecture des profils et rôles.");
    } else {
      const roleMap = new Map<string, string[]>();
      for (const item of (allRoleRows ?? []) as any[]) {
        const attached = Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : [];
        roleMap.set(item.user_id, [...(roleMap.get(item.user_id) ?? []), ...attached.map((role: any) => String(role.code ?? "").toUpperCase())]);
      }
      // N’afficher une absence synthétique que si une séance de formation planifiée
      // confirme l’absence et qu’aucun pointage journalier n’existe pour cette personne ce jour-là.
      // Ne jamais déclarer absent un apprenant simplement parce qu’il n’a pas de cours ce jour.
      const seenDayPerson = new Set(attendance.map((row) => `${row.local_date}:${row.person_id}`));
      const syntheticByDayPerson = new Map<string, Attendance>();
      for (const session of ((perSession ?? []) as SessionAttendance[])) {
        if (session.status.toLowerCase() !== "absent" || session.daily_attendance_id) continue;
        const key = `${session.session_date}:${session.person_id}`;
        if (seenDayPerson.has(key) || syntheticByDayPerson.has(key)) continue;
        syntheticByDayPerson.set(key, {
          id: `session-absent-${key}`,
          person_id: session.person_id,
          person_type: "student",
          local_date: session.session_date,
          nominal_time: session.nominal_time || session.planned_start || "",
          cutoff_time: session.cutoff_time || "",
          arrived_at: null,
          status: "absent",
          minutes_after_cutoff: 0
        });
      }
      attendance = [...attendance, ...syntheticByDayPerson.values()];
    }
    setProfiles(map);
    const formationNameById = new Map(((formationRows ?? []) as Formation[]).map((formation) => [formation.id, formation.name]));
    const studentNames: Record<string, string> = {};
    for (const student of (studentRows ?? []) as { id: string; formation_id: string | null }[]) {
      if (student.formation_id && formationNameById.has(student.formation_id)) studentNames[student.id] = formationNameById.get(student.formation_id)!;
    }
    setStudentFormationNames(studentNames);
    setRows(attendance);
    setBusy(false);
  }, [day, period]);

  useEffect(() => {
    if (isStaffView) { setPersonTypeFilter("staff"); setFormationFilter("all"); }
    else if (isStudentView) { setPersonTypeFilter("student"); }
    else {
      const type = new URLSearchParams(window.location.search).get("type");
      if (type === "staff" || type === "student") setPersonTypeFilter(type);
    }
  }, [isStaffView, isStudentView]);
  useEffect(() => { void load(); }, [load]);

  const scopedRows = useMemo(() => rows.filter((row) => isStaffView ? ["staff", "personnel", "teacher", "enseignant"].includes(row.person_type.toLowerCase()) : isStudentView ? !["staff", "personnel", "teacher", "enseignant"].includes(row.person_type.toLowerCase()) : true), [rows, isStaffView, isStudentView]);
  const totals = useMemo(() => ({
    checkins: scopedRows.length,
    late: scopedRows.filter((row) => row.status.toLowerCase() === "late").length,
    absent: scopedRows.filter((row) => row.status.toLowerCase() === "absent").length,
    staff: scopedRows.filter((row) => ["staff", "personnel"].includes(row.person_type.toLowerCase())).length,
    students: scopedRows.filter((row) => ["student", "apprenant"].includes(row.person_type.toLowerCase())).length
  }), [scopedRows]);
  const formationOptions = useMemo(() => [...new Set([...formations.map((formation) => formation.name), ...sessionRows.map((row) => row.formation_name).filter((name): name is string => Boolean(name))])].sort((a, b) => a.localeCompare(b, "fr")), [formations, sessionRows]);
  const formationCards = useMemo(() => formationOptions.map((name) => {
    const records = sessionRows.filter((row) => row.formation_name === name);
    return { name, total: records.length, present: records.filter((row) => ["present", "on_time"].includes(row.status.toLowerCase())).length, late: records.filter((row) => row.status.toLowerCase() === "late").length, absent: records.filter((row) => row.status.toLowerCase() === "absent").length, regularized: records.filter((row) => ["regularized", "regularized_late", "regularised", "regularised_late"].includes(row.status.toLowerCase())).length };
  }), [formationOptions, sessionRows]);
  const filteredAttendanceRows = useMemo(() => rows.filter((row) => {
    const staff = ["staff", "personnel", "teacher", "enseignant"].includes(row.person_type.toLowerCase());
    if (personTypeFilter === "staff" && !staff) return false;
    if (personTypeFilter === "student" && staff) return false;
    if (formationFilter !== "all" && studentFormationNames[row.person_id] !== formationFilter) return false;
    const status = row.status.toLowerCase();
    if (statusFilter === "present" && !["present", "on_time"].includes(status)) return false;
    if (statusFilter === "late" && status !== "late") return false;
    if (statusFilter === "absent" && status !== "absent") return false;
    if (statusFilter === "regularized" && !["regularized", "regularized_late", "regularised", "regularised_late", "paid"].includes(status)) return false;
    if (statusFilter === "upcoming" && !["scheduled", "upcoming", "pending"].includes(status)) return false;
    return true;
  }), [rows, personTypeFilter, formationFilter, statusFilter, studentFormationNames]);
  const filteredSessionRows = useMemo(() => sessionRows.filter((row) => {
    if (personTypeFilter === "staff") return false;
    if (formationFilter !== "all" && row.formation_name !== formationFilter) return false;
    const status = row.status.toLowerCase();
    if (statusFilter === "present" && !["present", "on_time"].includes(status)) return false;
    if (statusFilter === "late" && status !== "late") return false;
    if (statusFilter === "absent" && status !== "absent") return false;
    if (statusFilter === "regularized" && !["regularized", "regularized_late", "regularised", "regularised_late"].includes(status)) return false;
    if (statusFilter === "upcoming" && !["scheduled", "upcoming", "pending"].includes(status)) return false;
    return true;
  }), [sessionRows, formationFilter, statusFilter]);
  const selectedJustifications = useMemo(() => {
    const people = new Set([...filteredSessionRows.map((row) => row.person_id), ...filteredAttendanceRows.map((row) => row.person_id)]);
    return justifications.filter((item) => people.has(item.person_id));
  }, [justifications, filteredSessionRows, filteredAttendanceRows]);
  const ranking = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; count: number; minutes: number }>();
    for (const row of rows) {
      if (row.status.toLowerCase() !== "late") continue;
      if (isStaffView && !["staff", "personnel", "teacher", "enseignant"].includes(row.person_type.toLowerCase())) continue;
      const p = profiles[row.person_id];
      const current = grouped.get(row.person_id) ?? { id: row.person_id, name: fullName(p), count: 0, minutes: 0 };
      current.count += 1; current.minutes += Number(row.minutes_after_cutoff || 0);
      grouped.set(row.person_id, current);
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes || a.name.localeCompare(b.name));
  }, [rows, profiles, isStaffView]);

  if (!ready || busy) return <main style={styles.page}><section style={styles.card}>Chargement sécurisé du suivi de présence…</section></main>;
  if (!authorized) return <main style={styles.page}><section style={styles.card}><img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 100, height: 70, objectFit: "contain" }} /><h1>Suivi réservé à la Direction</h1><p>Connectez-vous avec un compte Direction, ADMIN ou PRE_ADMIN pour consulter les rapports.</p><a href="/">Retour à Aéro Service</a></section></main>;

  if (isChooser) return <main style={styles.page}><header style={styles.header}><div><div style={styles.eyebrow}>AÉRO SERVICE · DIRECTION</div><h1 style={{ margin: "6px 0" }}>Suivi des présences</h1><p style={styles.muted}>Choisissez directement l’espace que vous souhaitez consulter.</p></div><a href="/" style={styles.link}>← Accueil</a></header><section style={{ ...styles.stats, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}><a href="/direction/suivi/personnel" style={styles.choiceCard}><div style={styles.choiceIcon}>P</div><h2 style={styles.h2}>Personnel</h2><p style={styles.muted}>Consulter les présences du personnel, les retards, les absences et les régularisations.</p><strong style={{ color: "#174ea6" }}>Ouvrir le suivi du personnel →</strong></a><a href="/direction/suivi/apprenants" style={styles.choiceCard}><div style={styles.choiceIcon}>A</div><h2 style={styles.h2}>Apprenants</h2><p style={styles.muted}>Choisir une formation, puis consulter les séances et les dossiers des apprenants concernés.</p><strong style={{ color: "#174ea6" }}>Choisir une formation →</strong></a></section></main>;

  return <main style={styles.page}>
    <header style={styles.header}>
      <div><img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 74, height: 54, objectFit: "contain" }} /><div style={styles.eyebrow}>DIRECTION · CONTRÔLE DES PRÉSENCES</div><h1 style={{ margin: "6px 0" }}>{isStaffView ? "Suivi du personnel" : "Suivi des apprenants"}</h1><p style={styles.muted}>{isStaffView ? "Retards, absences, régularisations et historique du personnel." : "Choisissez une formation pour consulter les séances et les dossiers individuels."}</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><a href="/direction/suivi" style={styles.link}>← Choix du suivi</a><a href="/" style={styles.link}>Accueil</a><button style={styles.button} onClick={() => void load()}>Actualiser</button></div>
    </header>
    <section style={styles.toolbar}>
      <label style={styles.label}>Période<select value={period} onChange={(e) => setPeriod(e.target.value as "day" | "week")} style={styles.input}><option value="day">Bilan quotidien</option><option value="week">Bilan hebdomadaire (lundi–dimanche)</option></select></label>
      <label style={styles.label}>Date de référence<input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={styles.input} /></label>
      {!isStaffView && <label style={styles.label}>Statut<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={styles.input}><option value="all">Tous les statuts</option><option value="present">Présents</option><option value="late">En retard</option><option value="absent">Absents</option><option value="regularized">Régularisés</option><option value="upcoming">Séances à venir</option></select></label>}
      <div style={styles.note}>{isStaffView ? "Le suivi ci-dessous concerne uniquement le personnel." : "Le pointage tardif reste dans l’historique même après régularisation."}</div>
    </section>
    {error && <div style={styles.error}>{error}</div>}
    <section style={styles.stats}>
      {[["Pointages enregistrés", totals.checkins], ["Retards enregistrés", totals.late], ["Absences enregistrées", totals.absent], ["Personnel", totals.staff], ["Apprenants", totals.students]].map(([label, value]) => <div key={String(label)} style={styles.stat}><div style={styles.muted}>{label}</div><strong style={{ fontSize: 28 }}>{value}</strong></div>)}
    </section>
    {!isStaffView && <section style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}><div><h2 style={styles.h2}>Suivi par formation</h2><p style={styles.muted}>Choisissez une formation pour afficher ses séances et les apprenants concernés sur la période sélectionnée.</p></div><button style={styles.button} onClick={() => { setFormationFilter("all"); setStatusFilter("all"); setPersonTypeFilter("student"); }}>Toutes les formations</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        {formationCards.map((item) => <button key={item.name} aria-pressed={formationFilter === item.name} onClick={() => { setFormationFilter(item.name); setPersonTypeFilter("student"); setStatusFilter("all"); }} style={{ textAlign: "left", padding: 16, borderRadius: 14, border: formationFilter === item.name ? "2px solid #174ea6" : "1px solid #dce4ef", background: formationFilter === item.name ? "#eef5ff" : "#fff", color: "#16253b", cursor: "pointer", boxShadow: formationFilter === item.name ? "0 0 0 3px #dceaff" : "0 2px 8px rgba(20,42,70,.04)" }}><strong style={{ display: "block", marginBottom: 12, fontSize: 15 }}>{item.name}</strong><div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}><div style={{ padding: 8, background: "#e8f7ed", borderRadius: 8 }}><div style={{ fontSize: 11, color: "#17633a" }}>Présents</div><strong>{item.present}</strong></div><div style={{ padding: 8, background: "#fff0f0", borderRadius: 8 }}><div style={{ fontSize: 11, color: "#9a2727" }}>En retard</div><strong>{item.late}</strong></div><div style={{ padding: 8, background: "#fff0d8", borderRadius: 8 }}><div style={{ fontSize: 11, color: "#80500a" }}>Absents</div><strong>{item.absent}</strong></div><div style={{ padding: 8, background: "#fff4cc", borderRadius: 8 }}><div style={{ fontSize: 11, color: "#8a6100" }}>Régularisés</div><strong>{item.regularized}</strong></div></div><div style={{ ...styles.muted, marginTop: 10, fontWeight: 700, color: "#174ea6" }}>Ouvrir la formation →</div>{item.total === 0 && <div style={{ ...styles.muted, marginTop: 5 }}>Aucune séance chargée sur cette période</div>}</button>)}
      </div>
    </section>}
    {isStudentView && formationFilter !== "all" && personTypeFilter !== "staff" && <section style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}><div><div style={styles.eyebrow}>DOSSIERS DE FORMATION</div><h2 style={{ ...styles.h2, fontSize: 22, marginTop: 6 }}>{formationFilter}</h2><p style={styles.muted}>Les apprenants sont listés avec leur statut de présence. Les justifications associées sont présentées plus bas.</p></div><button style={styles.link} onClick={() => setFormationFilter("all")}>← Retour aux formations</button></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{([{v:"all",label:"Tous les statuts"},{v:"present",label:"Présents"},{v:"late",label:"En retard"},{v:"absent",label:"Absents"},{v:"regularized",label:"Régularisés"}] as const).map((item)=><button key={item.v} onClick={()=>setStatusFilter(item.v)} style={{ ...styles.button, background: statusFilter===item.v ? "#174ea6" : "#edf2f7", color: statusFilter===item.v ? "#fff" : "#263b56" }}>{item.label}</button>)}</div>
      {filteredSessionRows.length === 0 ? <p style={styles.muted}>Aucun dossier de séance pour cette formation à la date choisie.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Date</th><th>Apprenant</th><th>Heure prévue</th><th>Pointage</th><th>Statut</th><th>Retard</th></tr></thead><tbody>{filteredSessionRows.map((row)=>{const status=row.status.toLowerCase();const label=["present","on_time"].includes(status)?"Présent":status==="late"?"En retard":status==="absent"?"Absent":["regularized","regularized_late","regularised","regularised_late"].includes(status)?"Régularisé":"À venir";const badge=["present","on_time"].includes(status)?styles.ontime:status==="late"?styles.late:status==="absent"?styles.absent:["regularized","regularized_late","regularised","regularised_late"].includes(status)?styles.regularized:styles.pending;return <tr key={row.id}><td>{row.session_date}</td><td><strong>{fullName({id:row.person_id,display_name:row.display_name,first_name:row.first_name,last_name:row.last_name,email:null})}</strong>{row.student_number&&<div style={styles.muted}>N° {row.student_number}</div>}</td><td>{row.planned_start?.slice(0,5)}–{row.planned_end?.slice(0,5)}</td><td>{row.arrived_at?new Date(row.arrived_at).toLocaleTimeString("fr-FR",{timeZone:"Africa/Porto-Novo",hour:"2-digit",minute:"2-digit"}):"—"}</td><td><span style={{...styles.status,...badge}}>{label}</span></td><td>{minutesLabel(row.minutes_after_cutoff)}</td></tr>})}</tbody></table></div>}
      <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid #e5ebf3" }}><h3 style={{ margin: "0 0 8px", fontSize: 17 }}>Justifications et demandes de régularisation</h3><p style={styles.muted}>Motif, pièce justificative éventuelle et décision de traitement par la Direction.</p>
      {selectedJustifications.length === 0 ? <p style={styles.muted}>Aucune justification enregistrée pour les apprenants de cette sélection.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Date de demande</th><th>Apprenant</th><th>Motif</th><th>Justification</th><th>Pièce</th><th>Statut</th><th>Décision / commentaire</th></tr></thead><tbody>{selectedJustifications.map((j)=>{const p=profiles[j.person_id];const s=j.status.toLowerCase();const label=["approved","accepted","validated","accepted_by_director"].includes(s)?"Acceptée":["rejected","refused","denied"].includes(s)?"Refusée":["pending","submitted","under_review"].includes(s)?"En attente":j.status;const badge=["approved","accepted","validated","accepted_by_director"].includes(s)?styles.ontime:["rejected","refused","denied"].includes(s)?styles.absent:styles.pending;return <tr key={j.id}><td>{new Date(j.submitted_at).toLocaleDateString("fr-FR",{timeZone:"Africa/Porto-Novo"})}</td><td><strong>{fullName(p)}</strong></td><td>{j.reason_type||"—"}</td><td>{j.reason||"—"}</td><td>{j.document_url?<a href={j.document_url} target="_blank" rel="noreferrer" style={styles.link}>Ouvrir la pièce ↗</a>:"—"}</td><td><span style={{...styles.status,...badge}}>{label}</span></td><td>{j.review_comment||"—"}{j.reviewed_at&&<div style={styles.muted}>Traité le {new Date(j.reviewed_at).toLocaleDateString("fr-FR",{timeZone:"Africa/Porto-Novo"})}</div>}</td></tr>})}</tbody></table></div>}
      </div>
    </section>}
    {isStaffView && <section style={styles.card}>
      <h2 style={styles.h2}>Personnel le plus souvent en retard</h2>
      {ranking.length === 0 ? <p style={styles.muted}>Aucun retard enregistré sur cette période.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Rang</th><th>Nom et prénom</th><th>Catégorie</th><th>Nombre de retards</th><th>Minutes de retard cumulées</th></tr></thead><tbody>{ranking.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><strong>{item.name}</strong></td><td>{rows.find((row) => row.person_id === item.id)?.person_type === "staff" ? "Personnel" : "Apprenant"}</td><td>{item.count}</td><td>{item.minutes} min</td></tr>)}</tbody></table></div>}
    </section>}
    {isStudentView && formationFilter !== "all" && <section style={styles.card}>
      <h2 style={styles.h2}>Présence et absence par séance de formation</h2>
      <p style={styles.muted}>Un seul pointage journalier reste autorisé. Chaque séance prévue est suivie séparément : une arrivée après la fin d’un cours laisse ce cours marqué absent, même si l’apprenant pointe pour une séance plus tardive.</p>
      {personTypeFilter === "staff" ? <p style={styles.muted}>Le personnel est suivi dans le tableau de pointages ci-dessous ; le détail par séance concerne les formations des apprenants.</p> : filteredSessionRows.length === 0 ? <p style={styles.muted}>Aucune séance ne correspond à cette formation, cette date et ce statut.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Date</th><th>Apprenant</th><th>Formation</th><th>Séance</th><th>Heure prévue</th><th>Pointage journalier</th><th>Statut de la séance</th></tr></thead><tbody>{filteredSessionRows.map((row) => { const status = row.status.toLowerCase(); const label = ["present","on_time"].includes(status) ? "Présent" : status === "late" ? "En retard" : status === "absent" ? "Absent" : ["regularized","regularized_late","regularised","regularised_late"].includes(status) ? "Régularisé" : "À venir"; const badge = ["present","on_time"].includes(status) ? styles.ontime : status === "late" ? styles.late : status === "absent" ? styles.absent : ["regularized","regularized_late","regularised","regularised_late"].includes(status) ? styles.regularized : styles.pending; return <tr key={row.id}><td>{row.session_date}</td><td><strong>{fullName({ id: row.person_id, display_name: row.display_name, first_name: row.first_name, last_name: row.last_name, email: null })}</strong></td><td>{row.formation_name || "—"}</td><td>{row.planned_start?.slice(0,5)}–{row.planned_end?.slice(0,5)}</td><td>{row.nominal_time?.slice(0,5)}</td><td>{row.arrived_at ? new Date(row.arrived_at).toLocaleTimeString("fr-FR", { timeZone: "Africa/Porto-Novo", hour: "2-digit", minute: "2-digit" }) : "—"}</td><td><span style={{ ...styles.status, ...badge }}>{label}</span></td></tr>; })}</tbody></table></div>}
    </section>}
    {isStaffView && <section style={styles.card}>
      <h2 style={styles.h2}>Détail des pointages du personnel</h2>
      {filteredAttendanceRows.length === 0 ? <p style={styles.muted}>Aucun pointage ne correspond à cette catégorie sur la période.</p> : <div style={{ overflowX: "auto" }}><table style={styles.table}><thead><tr><th>Date</th><th>Nom et prénom</th><th>Catégorie</th><th>Heure prévue</th><th>Heure de pointage</th><th>Statut</th><th>Retard</th></tr></thead><tbody>{filteredAttendanceRows.map((row) => <tr key={row.id}><td>{row.local_date}</td><td><strong>{fullName(profiles[row.person_id])}</strong></td><td>{["staff", "personnel"].includes(row.person_type.toLowerCase()) ? "Personnel" : "Apprenant"}</td><td>{row.nominal_time?.slice(0, 5) || "—"}</td><td>{row.arrived_at ? new Date(row.arrived_at).toLocaleTimeString("fr-FR", { timeZone: "Africa/Porto-Novo", hour: "2-digit", minute: "2-digit" }) : "—"}</td><td><span style={{ ...styles.status, ...(["regularized", "regularized_late", "regularised", "regularised_late"].includes(row.status.toLowerCase()) ? styles.regularized : row.status.toLowerCase() === "late" ? styles.late : row.status.toLowerCase() === "absent" ? styles.absent : styles.ontime) }}>{statusLabel(row.status)}</span></td><td>{minutesLabel(row.minutes_after_cutoff)}</td></tr>)}</tbody></table></div>}
    </section>}
    <p style={styles.footer}>Aéro Service · Rapport calculé à partir des pointages présents dans la base de données.</p>
  </main>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: 24, background: "#f3f6fa", color: "#16253b", fontFamily: "Arial,sans-serif" },
  header: { maxWidth: 1180, margin: "0 auto 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" },
  eyebrow: { color: "#48617f", fontSize: 12, fontWeight: 800, letterSpacing: 1.4 },
  muted: { color: "#63738a", fontSize: 14, lineHeight: 1.5 },
  card: { maxWidth: 1180, margin: "0 auto 18px", padding: 20, border: "1px solid #dce4ef", borderRadius: 16, background: "#fff", boxShadow: "0 4px 18px rgba(20,42,70,.04)" },
  choiceCard: { display: "block", padding: 24, border: "1px solid #dce4ef", borderRadius: 16, background: "#fff", boxShadow: "0 4px 18px rgba(20,42,70,.04)", color: "#16253b", textDecoration: "none" } as React.CSSProperties,
  choiceIcon: { width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "#eaf1fa", color: "#174ea6", fontSize: 18, fontWeight: 800, marginBottom: 14 } as React.CSSProperties,
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
  regularized: { background: "#fff4cc", color: "#8a6100" },
  pending: { background: "#edf2f7", color: "#53657c" },
  footer: { maxWidth: 1180, margin: "0 auto", color: "#63738a", fontSize: 12 }
};
