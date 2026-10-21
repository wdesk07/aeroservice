"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type AgendaEvent = {
  id: string;
  title: string;
  event_type: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  reminder_at: string | null;
  created_by: string;
};
const types = [
  ["programme", "Programme de l’école"],
  ["meeting", "Réunion"],
  ["exam", "Examen"],
  ["defense", "Soutenance"],
  ["ceremony", "Remise / cérémonie"],
  ["deadline", "Échéance"],
  ["reminder", "Rappel"],
  ["other", "Autre événement"]
];
const roleNames = ["DIRECTOR", "ADMIN", "PRE_ADMIN"];
const blank = { title: "", event_type: "programme", description: "", starts_at: "", ends_at: "", reminder_at: "" };
const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 9, padding: "10px 12px", color: "#172b45", background: "#fff", font: "inherit" };
const buttonStyle: React.CSSProperties = { border: 0, borderRadius: 9, padding: "10px 14px", background: "#174ea6", color: "#fff", fontWeight: 700, cursor: "pointer" };
const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #dce4ef", borderRadius: 15, padding: 18, boxShadow: "0 4px 18px rgba(20,42,70,.04)" };
const mutedStyle: React.CSSProperties = { color: "#63738a", fontSize: 13, lineHeight: 1.5 };

function dateLabel(value: string) {
  return new Date(value).toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo", dateStyle: "medium", timeStyle: "short" });
}
function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default function DirectorAgendaPage() {
  const [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState("");
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("upcoming");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationsSupported, setNotificationsSupported] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (sessionError || !user) {
      setAuthorized(false); setReady(true); setBusy(false);
      return;
    }
    setUserId(user.id);
    const { data: roleRows, error: roleError } = await supabase.from("user_roles").select("roles(code)").eq("user_id", user.id);
    const codes = (roleRows ?? []).flatMap((item: any) => Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []).map((role: any) => String(role.code).toUpperCase());
    if (roleError || !codes.some((code: string) => roleNames.includes(code))) {
      setAuthorized(false); setReady(true); setBusy(false);
      return;
    }
    setAuthorized(true); setReady(true);
    const { data, error: agendaError } = await supabase.from("director_agenda_events")
      .select("id,title,event_type,description,starts_at,ends_at,reminder_at,created_by")
      .order("starts_at", { ascending: true }).limit(1000);
    if (agendaError) setError("Impossible de charger l’agenda. Vérifiez que la migration Agenda est appliquée sur TEST. " + agendaError.message);
    else setEvents((data ?? []) as AgendaEvent[]);
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const supported = typeof window !== "undefined" && "Notification" in window;
    setNotificationsSupported(supported);
    setNotificationsEnabled(supported && Notification.permission === "granted" && window.localStorage.getItem("aero_agenda_browser_notifications") === "on");
  }, []);
  useEffect(() => {
    if (!notificationsEnabled || !notificationsSupported || Notification.permission !== "granted") return;
    const checkReminders = () => {
      const now = Date.now();
      const due = events.filter((event) => event.reminder_at && new Date(event.reminder_at).getTime() <= now && new Date(event.starts_at).getTime() >= now - 24 * 60 * 60 * 1000);
      let alreadyNotified: string[] = [];
      try { alreadyNotified = JSON.parse(window.localStorage.getItem("aero_agenda_notified_v1") || "[]"); } catch { alreadyNotified = []; }
      const known = new Set(alreadyNotified);
      for (const event of due) {
        if (known.has(event.id)) continue;
        const body = `${dateLabel(event.starts_at)}${event.description ? " · " + event.description : ""}`;
        try {
          if ("serviceWorker" in navigator) {
            void navigator.serviceWorker.ready.then((registration) => registration.showNotification(`Rappel Aéro Service : ${event.title}`, { body, tag: `aero-agenda-${event.id}` })).catch(() => new Notification(`Rappel Aéro Service : ${event.title}`, { body, tag: `aero-agenda-${event.id}` }));
          } else new Notification(`Rappel Aéro Service : ${event.title}`, { body, tag: `aero-agenda-${event.id}` });
          known.add(event.id);
        } catch { /* La notification peut être bloquée par le navigateur ; l’alerte reste visible dans l’Agenda. */ }
      }
      window.localStorage.setItem("aero_agenda_notified_v1", JSON.stringify([...known].slice(-500)));
    };
    checkReminders();
    const timer = window.setInterval(checkReminders, 60_000);
    return () => window.clearInterval(timer);
  }, [events, notificationsEnabled, notificationsSupported]);

  async function enableBrowserNotifications() {
    if (!notificationsSupported) { setError("Ce navigateur ne prend pas en charge les notifications."); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setError("Autorisez les notifications dans les paramètres du navigateur pour recevoir les rappels."); return; }
    window.localStorage.setItem("aero_agenda_browser_notifications", "on");
    setNotificationsEnabled(true);
    setNotice("Rappels navigateur activés pour cet appareil lorsque l’Agenda est ouvert.");
  }

  const now = Date.now();
  const reminders = useMemo(() => events.filter((event) => event.reminder_at && new Date(event.reminder_at).getTime() <= now && new Date(event.starts_at).getTime() >= now - 24 * 60 * 60 * 1000), [events, now]);
  const visibleEvents = useMemo(() => events.filter((event) => {
    const start = new Date(event.starts_at).getTime();
    if (filter === "upcoming") return start >= now;
    if (filter === "past") return start < now;
    return true;
  }), [events, filter, now]);

  async function createEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setNotice("");
    if (!userId || !form.title.trim() || !form.starts_at) {
      setError("Indiquez au minimum le titre et la date/heure de début.");
      return;
    }
    const start = new Date(form.starts_at);
    const end = form.ends_at ? new Date(form.ends_at) : null;
    const reminder = form.reminder_at ? new Date(form.reminder_at) : null;
    if (Number.isNaN(start.getTime()) || (end && end < start) || (reminder && Number.isNaN(reminder.getTime()))) {
      setError("Vérifiez les dates : la fin ne peut pas précéder le début.");
      return;
    }
    setSaving(true);
    const { error: insertError } = await supabase.from("director_agenda_events").insert({
      title: form.title.trim(),
      event_type: form.event_type,
      description: form.description.trim() || null,
      starts_at: start.toISOString(),
      ends_at: end?.toISOString() ?? null,
      reminder_at: reminder?.toISOString() ?? null,
      created_by: userId
    });
    if (insertError) setError("Événement non enregistré : " + insertError.message);
    else {
      setForm(blank); setShowForm(false); setNotice("Événement ajouté à l’agenda.");
      await load();
    }
    setSaving(false);
  }

  async function deleteEvent(event: AgendaEvent) {
    if (!window.confirm(`Supprimer « ${event.title} » de l’agenda ?`)) return;
    setError(""); setNotice("");
    const { error: deleteError } = await supabase.from("director_agenda_events").delete().eq("id", event.id);
    if (deleteError) setError("Suppression impossible : " + deleteError.message);
    else { setNotice("Événement supprimé."); await load(); }
  }

  if (!ready || busy) return <main style={{ minHeight: "100vh", background: "#f3f6fa", padding: 24, color: "#172b45" }}><section style={{ ...cardStyle, maxWidth: 900, margin: "0 auto" }}>Chargement de l’agenda…</section></main>;
  if (!authorized) return <main style={{ minHeight: "100vh", background: "#f3f6fa", padding: 24, color: "#172b45" }}><section style={{ ...cardStyle, maxWidth: 680, margin: "0 auto" }}><img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" style={{ width: 92, height: 64, objectFit: "contain" }} /><h1>Agenda réservé à la Direction</h1><p>Connectez-vous avec un compte Direction, ADMIN ou PRE_ADMIN.</p><a href="/">Retour à Aéro Service</a></section></main>;

  return <main style={{ minHeight: "100vh", padding: 24, background: "#f3f6fa", color: "#172b45", fontFamily: "Arial,sans-serif" }}>
    <header style={{ maxWidth: 1120, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}><img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" style={{ width: 72, height: 56, objectFit: "contain" }} /><div><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: "#48617f" }}>DIRECTION · ORGANISATION</div><h1 style={{ margin: "5px 0", fontSize: 30 }}>Agenda de l’école</h1><p style={{ ...mutedStyle, margin: 0 }}>Programmes, examens, soutenances, remises et rappels importants.</p></div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><a href="/" style={{ ...buttonStyle, background: "#fff", color: "#174ea6", border: "1px solid #cbd5e1", textDecoration: "none" }}>← Tableau de bord</a>{notificationsSupported && Notification.permission !== "denied" && <button style={{ ...buttonStyle, background: notificationsEnabled ? "#e8f7ed" : "#eef3f9", color: notificationsEnabled ? "#17633a" : "#174ea6", border: "1px solid #cbd5e1" }} onClick={() => void enableBrowserNotifications()}>{notificationsEnabled ? "✓ Rappels activés" : "Activer les rappels"}</button>}<button style={buttonStyle} onClick={() => { setForm(blank); setShowForm(!showForm); setError(""); setNotice(""); }}>{showForm ? "Fermer" : "+ Ajouter un événement"}</button></div>
    </header>
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      {error && <div role="alert" style={{ marginBottom: 14, padding: 13, borderRadius: 10, color: "#922", background: "#fff0f0", border: "1px solid #f2c7c7" }}>{error}</div>}
      {notice && <div role="status" style={{ marginBottom: 14, padding: 13, borderRadius: 10, color: "#17633a", background: "#e8f7ed", border: "1px solid #b9e4c8" }}>{notice}</div>}
      {reminders.length > 0 && <section style={{ ...cardStyle, marginBottom: 16, borderColor: "#e5b95c", background: "#fffaf0" }}><h2 style={{ margin: "0 0 8px", fontSize: 18 }}>🔔 Rappels à consulter ({reminders.length})</h2>{reminders.map((event) => <div key={event.id} style={{ padding: "8px 0", borderTop: "1px solid #f1dfb5" }}><strong>{event.title}</strong><div style={mutedStyle}>Prévu le {dateLabel(event.starts_at)}{event.description ? ` · ${event.description}` : ""}</div></div>)}</section>}
      {showForm && <form onSubmit={createEvent} style={{ ...cardStyle, marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Titre de l’événement<input style={fieldStyle} value={form.title} maxLength={160} required onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex. Soutenance de la promotion PNC" /></label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Catégorie<select style={fieldStyle} value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Début<input style={fieldStyle} type="datetime-local" required value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Fin (facultatif)<input style={fieldStyle} type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Me rappeler le<input style={fieldStyle} type="datetime-local" value={form.reminder_at} onChange={(e) => setForm({ ...form, reminder_at: e.target.value })} /></label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, gridColumn: "1 / -1" }}>Notes / détails<textarea style={{ ...fieldStyle, minHeight: 86, resize: "vertical" }} value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Informations utiles pour la Direction…" /></label>
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><button style={buttonStyle} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer l’événement"}</button><span style={mutedStyle}>Les événements sont enregistrés sur la base TEST et partagés entre les comptes autorisés de la Direction.</span></div>
      </form>}
      <section style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}><div><h2 style={{ margin: "0 0 5px", fontSize: 19 }}>Planning</h2><p style={{ ...mutedStyle, margin: 0 }}>{events.length} événement(s) enregistré(s)</p></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{[["upcoming", "À venir"], ["all", "Tout"], ["past", "Passés"]].map(([value, label]) => <button key={value} onClick={() => setFilter(value as typeof filter)} style={{ ...buttonStyle, background: filter === value ? "#174ea6" : "#eef3f9", color: filter === value ? "#fff" : "#29425f" }}>{label}</button>)}<button onClick={() => void load()} style={{ ...buttonStyle, background: "#fff", color: "#174ea6", border: "1px solid #cbd5e1" }}>Actualiser</button></div></div>
        {visibleEvents.length === 0 ? <p style={mutedStyle}>Aucun événement dans cette vue. Ajoutez un programme ou une échéance pour commencer.</p> : <div style={{ display: "grid", gap: 10, marginTop: 14 }}>{visibleEvents.map((event) => <article key={event.id} style={{ border: "1px solid #e0e7f0", borderRadius: 12, padding: 14, display: "flex", gap: 16, justifyContent: "space-between", alignItems: "start", flexWrap: "wrap" }}><div style={{ minWidth: 220, flex: 1 }}><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong style={{ fontSize: 16 }}>{event.title}</strong><span style={{ borderRadius: 999, padding: "4px 8px", background: "#edf3fb", color: "#31577f", fontSize: 11, fontWeight: 700 }}>{types.find(([value]) => value === event.event_type)?.[1] ?? "Autre événement"}</span></div><p style={{ margin: "7px 0", fontSize: 13, color: "#334861" }}>Début : {dateLabel(event.starts_at)}{event.ends_at ? ` · Fin : ${dateLabel(event.ends_at)}` : ""}</p>{event.reminder_at && <p style={{ margin: "4px 0", fontSize: 12, color: "#80500a" }}>🔔 Rappel : {dateLabel(event.reminder_at)}</p>}{event.description && <p style={{ ...mutedStyle, margin: "7px 0 0", whiteSpace: "pre-wrap" }}>{event.description}</p>}</div><button onClick={() => void deleteEvent(event)} style={{ ...buttonStyle, background: "#fff0f0", color: "#922", border: "1px solid #f2c7c7" }}>Supprimer</button></article>)}</div>}
      </section>
      <p style={{ ...mutedStyle, textAlign: "center" }}>Les rappels apparaissent dans l’Agenda. Après activation, les notifications du navigateur peuvent aussi apparaître lorsque l’onglet est ouvert ou en arrière-plan. Les notifications quand le navigateur est complètement fermé nécessitent un service push supplémentaire.</p>
    </div>
  </main>;
}
