"use client";

import { useEffect, useState } from "react";

export default function OfflineStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [workNotes, setWorkNotes] = useState(0);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      try {
        const events = JSON.parse(localStorage.getItem("aero_offline_attendance_queue") || "[]");
        setPending(Array.isArray(events) ? events.length : 0);
        const notes = JSON.parse(localStorage.getItem("aero_offline_workpad_v1") || "[]");
        setWorkNotes(Array.isArray(notes) ? notes.length : 0);
      } catch { setPending(0); setWorkNotes(0); }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const interval = window.setInterval(update, 3000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.clearInterval(interval);
    };
  }, []);

  if (online && pending === 0 && workNotes === 0) return null;
  return (
    <div role="status" aria-live="polite" style={{
      padding: "9px 14px", fontSize: 13, lineHeight: 1.45,
      color: online ? "#17436d" : "#744b00",
      background: online ? "#e8f3ff" : "#fff0c2",
      borderBottom: "1px solid " + (online ? "#c4dcf6" : "#e6cf8a")
    }}>
      <strong>{online ? "Synchronisation à vérifier" : "Aéro Service — hors connexion"}</strong>
      {" — "}
      {online
        ? pending + " observation(s) de présence à synchroniser et " + workNotes + " note(s) de reprise conservée(s) localement. Les notes ne sont pas envoyées au serveur."
        : "Les données du serveur ne sont pas actualisées. " + pending + " observation(s) de présence et " + workNotes + " note(s) de reprise sont conservées localement ; les opérations officielles nécessitant le serveur sont suspendues."}
    </div>
  );
}
