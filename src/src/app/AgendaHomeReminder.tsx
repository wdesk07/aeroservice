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

const dateLabel = (value: string) =>
  new Date(value).toLocaleString("fr-FR", {
    timeZone: "Africa/Porto-Novo",
    dateStyle: "full",
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
      if (!user) { setEvents([]); setLoaded(true); return; }

      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("roles(code)")
        .eq("user_id", user.id);
      const codes = (roleRows ?? []).flatMap((item: any) =>
        Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []
      ).map((role: any) => String(role.code ?? "").toUpperCase());
      if (roleError || !codes.some((code: string) => ["DIRECTOR", "PRE_ADMIN", "ADMIN"].includes(code))) {
        if (!cancelled) { setEvents([]); setLoaded(true); }
        return;
      }

      const { data, error } = await supabase
        .from("director_agenda_events")
        .select("id,title,event_type,description,starts_at,ends_at,reminder_at")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(20);

      if (!cancelled) {
        if (error) setEvents([]);
        else {
          const now = Date.now();
          const upcoming = ((data ?? []) as AgendaEvent[]).filter((event) => {
            const start = new Date(event.starts_at).getTime();
            const reminderDue = !!event.reminder_at && new Date(event.reminder_at).getTime() <= now;
            const startsSoon = start - now <= 7 * 24 * 60 * 60 * 1000;
            return reminderDue || startsSoon;
          });
          setEvents(upcoming);
        }
        setLoaded(true);
      }
    }
    void loadReminders();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void loadReminders();
    });
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
    <aside aria-label="Rappels de l’agenda" style={{ maxWidth: 1180, margin: "0 auto 18px", padding: "0 20px" }}>
      <section style={{ border: "2px solid #e4b64e", borderRadius: 15, padding: 18, background: "#fff8e7", color: "#573d08", boxShadow: "0 5px 20px rgba(70,48,5,.08)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span aria-hidden="true" style={{ fontSize: 27 }}>🔔</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Rappel important — votre planning</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>Ces événements à venir sont affichés automatiquement à votre arrivée sur l’accueil.</p>
          </div>
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {visible.map((event) => {
            const reminderDue = !!event.reminder_at && new Date(event.reminder_at).getTime() <= Date.now();
            return <article key={event.id} style={{ background: "#fff", border: "1px solid #eed89e", borderRadius: 10, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px" }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{event.title}</div>
                <div style={{ marginTop: 5, fontSize: 13 }}>{dateLabel(event.starts_at)}{event.ends_at ? " · Fin : " + dateLabel(event.ends_at) : ""}</div>
                {event.description && <p style={{ margin: "6px 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{event.description}</p>}
                {reminderDue && <div style={{ marginTop: 7, fontSize: 12, fontWeight: 800, color: "#a33b16" }}>Le moment du rappel est arrivé.</div>}
              </div>
              <button type="button" onClick={() => setDismissed((old) => [...old, event.id])} style={{ border: "1px solid #d8c38b", borderRadius: 8, padding: "7px 10px", background: "#fffdf7", color: "#573d08", fontWeight: 700, cursor: "pointer" }}>J’ai vu ce rappel</button>
            </article>;
          })}
        </div>
        <div style={{ marginTop: 12 }}><a href="/direction/agenda" style={{ color: "#174ea6", fontWeight: 800 }}>Ouvrir l’Agenda →</a></div>
      </section>
    </aside>
  );
}
