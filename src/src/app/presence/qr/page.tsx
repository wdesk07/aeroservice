"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type RequestResult = {
  ok?: boolean;
  duplicate?: boolean;
  request_id?: string;
  status?: string;
  delay_minutes?: number;
  arrived_at?: string;
};

function friendlyError(raw: string) {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: "Identifiant ou mot de passe incorrect.",
    ACTIVE_STUDENT_REQUIRED: "Ce compte n’est pas un compte apprenant actif autorisé au pointage.",
    OPERATING_DAY_CLOSED: "Le pointage n’est pas ouvert aujourd’hui. Adressez-vous au secrétariat.",
    STUDENT_CHECKIN_CLOSED: "La période de pointage est fermée.",
    CHECKIN_WINDOW_CLOSED: "La séance est terminée. Présentez-vous au secrétariat si vous devez régulariser votre situation.",
    NO_TRAINING_SESSION_SCHEDULED_TODAY: "Aucune séance correspondant à votre formation n’est programmée aujourd’hui.",
    QR_CHECKIN_RATE_LIMIT: "Trop de demandes de pointage. Présentez-vous directement au secrétariat.",
    ATTENDANCE_ALREADY_RECORDED: "Votre présence est déjà enregistrée pour cette séance.",
    SERVICE_UNAVAILABLE: "Le service est temporairement indisponible. Réessayez ou présentez-vous au secrétariat.",
    TOO_MANY_ATTEMPTS: "Trop de tentatives. Attendez quinze minutes avant de réessayer."
  };
  const key = Object.keys(messages).find((item) => raw.includes(item));
  return key ? messages[key] : raw;
}

export default function MobileQrCheckinPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RequestResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const { data: authPayload, error: authError } = await supabase.functions.invoke("kiosk-auth", {
        body: { identifier: identifier.trim(), password }
      });
      if (authError || !authPayload?.access_token || !authPayload?.refresh_token) {
        const context = (authError as unknown as { context?: unknown } | null)?.context;
        let detail = authPayload?.error || "SERVICE_UNAVAILABLE";
        if (context instanceof Response) {
          try { detail = (await context.clone().json())?.error || detail; } catch { /* Keep generic error. */ }
        }
        throw new Error(detail);
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: authPayload.access_token,
        refresh_token: authPayload.refresh_token
      });
      if (sessionError || !sessionData.user) throw new Error("Connexion apprenant impossible.");

      const { data, error: requestError } = await supabase.rpc("request_qr_checkin");
      await supabase.auth.signOut();
      setPassword("");
      if (requestError) throw new Error(requestError.message);
      if (!data?.ok) throw new Error("Le serveur n’a pas confirmé la demande de pointage.");
      setResult(data as RequestResult);
    } catch (err) {
      await supabase.auth.signOut();
      setPassword("");
      setError(friendlyError(err instanceof Error ? err.message : "Demande de pointage impossible."));
    } finally {
      setBusy(false);
    }
  }

  const delay = Number(result?.delay_minutes ?? 0);
  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fa", color: "#15243a", padding: "24px 14px", fontFamily: "Arial,sans-serif" }}>
      <section style={{ maxWidth: 560, margin: "0 auto", background: "#fff", border: "1px solid #dce4ef", borderRadius: 18, padding: 24, boxShadow: "0 8px 30px rgba(24,48,80,.08)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 74, height: 66, objectFit: "contain" }} />
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: "#45627f" }}>AÉRO SERVICE</p>
            <h1 style={{ margin: 0, fontSize: 25 }}>Pointage par QR code</h1>
            <p style={{ margin: "5px 0 0", color: "#52647a" }}>Identification sécurisée de l’apprenant</p>
          </div>
        </header>

        {!result ? (
          <>
            <div style={{ borderRadius: 12, background: "#edf4ff", padding: 14, lineHeight: 1.55, marginBottom: 18 }}>
              Scannez ce QR code à l’entrée, identifiez-vous et envoyez votre demande de pointage. <strong>Votre présence ne sera définitive qu’après confirmation physique par le secrétariat.</strong>
            </div>
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>E-mail ou matricule apprenant
                <input autoComplete="username" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} style={inputStyle} placeholder="E-mail ou matricule" />
              </label>
              <label style={labelStyle}>Mot de passe
                <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} />
              </label>
              <button type="submit" disabled={busy} style={primaryButton}>{busy ? "Vérification sécurisée…" : "M’identifier et pointer"}</button>
            </form>
          </>
        ) : (
          <div role="status" style={{ borderRadius: 14, padding: 18, background: delay > 0 ? "#fff3cd" : "#eaf7ef", border: "1px solid " + (delay > 0 ? "#f0d879" : "#b8e1c4"), lineHeight: 1.6 }}>
            <h2 style={{ marginTop: 0, color: delay > 0 ? "#805b00" : "#17663b" }}>{delay > 0 ? "Vous êtes en retard" : "Demande de pointage envoyée"}</h2>
            {delay > 0 ? (
              <p>Retard calculé par le serveur : <strong>{delay} minute(s)</strong>. Veuillez vous présenter à la secrétaire pour confirmer votre présence et régulariser votre situation avant d’accéder au cours.</p>
            ) : (
              <p>Votre demande a été enregistrée à l’heure prévue. Présentez-vous au secrétariat afin que votre présence physique soit confirmée avant l’accès au cours.</p>
            )}
            <p style={{ marginBottom: 0 }}>Référence : <strong>{result.request_id?.slice(0, 8).toUpperCase() || "—"}</strong>. Le scan seul ne donne pas l’autorisation d’entrer en cours.</p>
            <button type="button" onClick={() => { setResult(null); setIdentifier(""); setPassword(""); }} style={secondaryButton}>Terminer</button>
          </div>
        )}

        {error && <p role="alert" style={{ marginTop: 16, padding: 13, borderRadius: 10, background: "#fff0f0", color: "#8f2020", lineHeight: 1.5 }}>{error}</p>}
        <p style={{ margin: "22px 0 0", fontSize: 12, color: "#66778b", lineHeight: 1.55 }}>Sécurité : le serveur contrôle votre compte et la séance. Une demande QR n’est pas une présence définitive ; la secrétaire doit vous voir physiquement et confirmer le pointage.</p>
      </section>
    </main>
  );
}

const primaryButton: React.CSSProperties = { width: "100%", border: 0, borderRadius: 10, padding: "14px 16px", background: "#174ea6", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" };
const secondaryButton: React.CSSProperties = { width: "100%", border: "1px solid #c7d4e4", borderRadius: 10, padding: "12px 16px", background: "#fff", color: "#243b53", fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 12 };
const labelStyle: React.CSSProperties = { display: "grid", gap: 6, fontSize: 14, fontWeight: 700 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 13px", borderRadius: 9, border: "1px solid #c7d4e4", fontSize: 16, boxSizing: "border-box" };
