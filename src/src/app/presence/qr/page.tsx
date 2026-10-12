"use client";

import { useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

// Permanent public destination for the printed entrance QR.
// The database RPC remains the authority for identity, time, geofence and duplicates.
const ENTRANCE_CHECKPOINT_ID = "a7c6e512-0f06-447e-b57b-8831d11f7ae9";

type CheckinResult = {
  ok?: boolean;
  duplicate?: boolean;
  status?: "on_time" | "late";
  arrived_at?: string;
  nominal_time?: string;
  cutoff_time?: string;
  minutes_after_cutoff?: number;
  checkpoint?: string;
};

export default function DailyQrPresencePage() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      setSignedIn(!error && Boolean(data.session?.user));
      setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setSignedIn(Boolean(session?.user));
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function recordPresence() {
    setMessage("");
    setResult(null);
    if (!signedIn) {
      setMessage("Connectez-vous d’abord à Aéro Service, puis rescanez le QR code de l’entrée.");
      return;
    }
    if (!navigator.geolocation) {
      setMessage("La géolocalisation n’est pas disponible sur cet appareil. Autorisez la localisation ou utilisez un appareil compatible.");
      return;
    }

    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { data, error } = await supabase.rpc("qr_daily_checkin", {
            p_checkpoint_id: ENTRANCE_CHECKPOINT_ID,
            p_lat: position.coords.latitude,
            p_lng: position.coords.longitude,
            p_accuracy_m: position.coords.accuracy,
          });
          if (error) {
            const raw = error.message || "Erreur inconnue";
            const messages: Record<string, string> = {
              AUTH_REQUIRED: "Votre session a expiré. Connectez-vous puis rescanez le QR code.",
              GPS_REQUIRED_OR_INACCURATE: "La précision GPS est insuffisante. Activez la localisation précise et réessayez.",
              OUTSIDE_CHECKPOINT_RADIUS: "Vous êtes hors de la zone autorisée de l’entrée Aéro Service.",
              CHECKPOINT_INACTIVE: "Ce point de présence est désactivé. Contactez le secrétariat.",
              CHECKPOINT_GEOFENCE_NOT_CONFIGURED: "Le point GPS n’est pas encore activé par l’administration.",
              PERSON_NOT_REGISTERED: "Votre compte n’est pas associé à un profil apprenant ou personnel autorisé.",
              "duplicate key value violates unique constraint": "Votre présence du jour a déjà été enregistrée.",
            };
            const match = Object.keys(messages).find((key) => raw.includes(key));
            throw new Error(match ? messages[match] : raw);
          }
          const payload = data as CheckinResult;
          if (!payload?.ok) throw new Error("Le serveur n’a pas confirmé le pointage.");
          setResult(payload);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Impossible d’enregistrer la présence. Réessayez.");
        } finally {
          setBusy(false);
        }
      },
      (error) => {
        const reason = error.code === error.PERMISSION_DENIED
          ? "Autorisez la localisation dans les réglages du téléphone et du navigateur."
          : error.code === error.POSITION_UNAVAILABLE
            ? "Position GPS indisponible. Vérifiez que la localisation est activée."
            : "Le GPS met trop de temps à répondre. Réessayez à l’extérieur.";
        setMessage(reason);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fa", padding: "28px 16px", color: "#15243a", fontFamily: "Arial, sans-serif" }}>
      <section style={{ maxWidth: 520, margin: "0 auto", background: "#fff", border: "1px solid #dce4ef", borderRadius: 18, padding: 24, boxShadow: "0 8px 30px rgba(24,48,80,.08)" }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: "#e8f1ff", color: "#174ea6", display: "grid", placeItems: "center", fontSize: 28, marginBottom: 16 }} aria-hidden="true">✈</div>
        <p style={{ margin: "0 0 6px", fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: "#45627f" }}>AÉRO SERVICE</p>
        <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: "0 0 10px" }}>Présence quotidienne</h1>
        <p style={{ color: "#52647a", lineHeight: 1.6, marginTop: 0 }}>Pointage à l’entrée principale. Gardez la localisation précise activée et restez près du QR code affiché à l’entrée.</p>

        {checkingSession ? (
          <p role="status">Vérification de la connexion…</p>
        ) : !signedIn ? (
          <div style={{ background: "#fff7e6", border: "1px solid #f2d49b", padding: 14, borderRadius: 10, lineHeight: 1.5 }}>
            <strong>Connexion requise</strong>
            <p style={{ margin: "6px 0 12px" }}>Connectez-vous à votre compte Aéro Service, puis rescanez ce QR code pour pointer.</p>
            <a href="/" style={{ color: "#174ea6", fontWeight: 700 }}>Ouvrir Aéro Service et se connecter</a>
          </div>
        ) : (
          <button type="button" onClick={recordPresence} disabled={busy} style={{ width: "100%", border: 0, borderRadius: 10, padding: "14px 16px", background: busy ? "#8da8cb" : "#174ea6", color: "#fff", fontSize: 16, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Vérification GPS et pointage…" : "Enregistrer ma présence"}
          </button>
        )}

        {message && <p role="alert" style={{ marginTop: 16, padding: 13, borderRadius: 10, background: "#fff0f0", color: "#8f2020", lineHeight: 1.5 }}>{message}</p>}

        {result && (
          <div role="status" style={{ marginTop: 16, padding: 16, borderRadius: 12, background: result.duplicate ? "#fff7e6" : "#eaf7ef", border: "1px solid " + (result.duplicate ? "#f2d49b" : "#b8e0c5") }}>
            <h2 style={{ fontSize: 19, margin: "0 0 8px" }}>{result.duplicate ? "Présence déjà enregistrée" : "Présence enregistrée"}</h2>
            <p style={{ margin: "4px 0" }}>Statut : <strong>{result.status === "late" ? "En retard" : "À l’heure"}</strong></p>
            {result.arrived_at && <p style={{ margin: "4px 0" }}>Heure du pointage : {new Date(result.arrived_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Porto-Novo" })}</p>}
            {result.duplicate && <p style={{ margin: "8px 0 0" }}>Le système conserve le premier pointage de la journée.</p>}
            {!result.duplicate && result.status === "late" && <p style={{ margin: "8px 0 0" }}>Retard calculé par le serveur selon votre catégorie et l’heure locale du Bénin.</p>}
          </div>
        )}

        <p style={{ margin: "20px 0 0", fontSize: 12, lineHeight: 1.5, color: "#66778b" }}>La date, l’heure, le rayon GPS et les doublons sont contrôlés côté serveur. Le pointage quotidien est distinct de la présence à une séance de formation.</p>
      </section>
    </main>
  );
}
