"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
};

const dateLabel = (value: string) => new Date(value).toLocaleString("fr-FR", {
  timeZone: "Africa/Porto-Novo",
  dateStyle: "medium",
  timeStyle: "short",
});

export default function AgendaHomeReminder() {
  const pathname = usePathname();
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadReminders() {
      if (pathname !== "/") { setEvents([]); setLoaded(true); return; }
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) { if (!cancelled) { setEvents([]); setLoaded(true); } return; }

      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles").select("roles(code)").eq("user_id", user.id);
      const codes = (roleRows ?? []).flatMap((item: any) =>
        Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []
      ).map((role: any) => String(role.code ?? "").toUpperCase());
      if (roleError || !codes.some((code: string) => ["DIRECTOR", "PRE_ADMIN", "ADMIN"].includes(code))) {
        if (!cancelled) { setEvents([]); setLoaded(true); }
        return;
      }

      const { data, error } = await supabase.from("director_agenda_events")
        .select("id,title,event_type,description,starts_at,ends_at,reminder_at")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true }).limit(20);

      if (cancelled) return;
      if (error) setEvents([]);
      else {
        const now = Date.now();
        setEvents(((data ?? []) as AgendaEvent[]).filter((event) => {
          const start = new Date(event.starts_at).getTime();
          const reminderDue = !!event.reminder_at && new Date(event.reminder_at).getTime() <= now;
          return reminderDue || start - now <= 7 * 24 * 60 * 60 * 1000;
        }));
      }
      setLoaded(true);
    }
    void loadReminders();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => { void loadReminders(); });
    window.addEventListener("focus", loadReminders);
    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      window.removeEventListener("focus", loadReminders);
    };
  }, [pathname]);

  if (pathname !== "/" || !loaded || events.length === 0) return null;
  const visible = events.filter((event) => !dismissed.includes(event.id));
  if (visible.length === 0) return null;

  return (
    <section aria-label="Rappels de l’agenda" style={{ margin: "0 0 22px", padding: "0 0 2px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ color: "#60738b", fontSize: 11, fontWeight: 800, letterSpacing: 1.25, textTransform: "uppercase" }}>Agenda · À retenir</div>
          <h2 style={{ margin: "4px 0 0", color: "#173b63", fontSize: 18, fontWeight: 750, letterSpacing: "-.2px" }}>Prochains rendez-vous</h2>
        </div>
        <a href="/direction/agenda" style={{ color: "#174ea6", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Voir l’Agenda →</a>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {visible.map((event) => {
          const hasReminder = !!event.reminder_at;
          const reminderDue = hasReminder && new Date(event.reminder_at!).getTime() <= Date.now();
          return (
            <article key={event.id} style={{ display: "grid", gridTemplateColumns: "5px minmax(0,1fr) auto", gap: 14, alignItems: "stretch", padding: "15px 16px", border: hasReminder ? "1px solid #e6bd61" : "1px solid #c9dced", borderRadius: 12, background: hasReminder ? "linear-gradient(110deg, #fff1c9 0%, #fffaf0 58%, #ffffff 100%)" : "linear-gradient(110deg, #f0f7ff 0%, #ffffff 72%)", boxShadow: hasReminder ? "0 4px 14px rgba(161,116,35,.14)" : "0 3px 12px rgba(32,91,145,.07)" }}>
              <div aria-hidden="true" style={{ background: hasReminder ? "#d18b12" : "#397bb7", borderRadius: 8 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ color: "#173b63", fontSize: 14 }}>{event.title}</strong>
                  {hasReminder && <span style={{ color: reminderDue ? "#713f08" : "#805719", background: reminderDue ? "#f5c45e" : "#ffedb5", border: "1px solid #e6bd61", borderRadius: 5, padding: "4px 8px", fontSize: 10, fontWeight: 850, letterSpacing: ".45px" }}>{reminderDue ? "RAPPEL" : "À RETENIR"}</span>}
                </div>
                <div style={{ marginTop: 5, color: "#536a82", fontSize: 12 }}>{dateLabel(event.starts_at)}{event.ends_at ? " · Fin : " + dateLabel(event.ends_at) : ""}</div>
                {event.description && <p style={{ margin: "6px 0 0", color: "#52657a", fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{event.description}</p>}
              </div>
              <button type="button" aria-label="Masquer ce rappel" onClick={() => setDismissed((old) => [...old, event.id])} style={{ alignSelf: "center", border: hasReminder ? "1px solid #dfb44f" : "1px solid #c5d8e9", borderRadius: 8, padding: "7px 10px", background: hasReminder ? "#ffedb5" : "#e6f1fb", color: hasReminder ? "#70450d" : "#214d78", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Compris</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
