"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient, type User } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type AttendanceResult = {
  ok?: boolean;
  duplicate?: boolean;
  status?: "on_time" | "late" | "absent" | "regularized";
  arrived_at?: string;
  minutes_after_cutoff?: number;
  checkpoint?: string;
};

function errorMessage(raw: string) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "La session a expiré. Reconnectez-vous sur la borne.",
    KIOSK_NOT_REGISTERED: "Cette borne n’est pas activée. Demandez à la Direction de l’enregistrer.",
    KIOSK_ADMIN_REQUIRED: "Seuls la Direction, la pré-administration ou le secrétariat autorisé peuvent ouvrir ou fermer la journée et gérer la borne.",
    OPERATING_DAY_CLOSED: "La journée est fermée. La Direction doit ouvrir la journée et activer la borne.",
    OPERATING_DAY_ALREADY_CLOSED: "La journée est déjà fermée. La borne ne peut plus être activée aujourd’hui.",
    OPERATING_DAY_NOT_OPEN: "Aucune journée ouverte à fermer. Ouvrez d’abord la journée et activez la borne.",
    INVALID_CREDENTIALS: "Identifiant ou mot de passe incorrect, ou compte apprenant non autorisé.",
    TOO_MANY_ATTEMPTS: "Trop de tentatives. Attendez quinze minutes avant de réessayer.",
    SERVICE_UNAVAILABLE: "Le service de connexion est temporairement indisponible. Réessayez plus tard.",
    ACTIVE_STUDENT_REQUIRED: "Ce compte n’est pas un compte apprenant actif autorisé au pointage.",
    STUDENT_CHECKIN_CLOSED: "La période de pointage quotidien est fermée.",
    OUTSIDE_CHECKPOINT_RADIUS: "La position détectée est hors de la zone autorisée du centre.",
    "Invalid login credentials": "Identifiants incorrects. Vérifiez votre e-mail et votre mot de passe.",
  };
  const key = Object.keys(messages).find((item) => raw.includes(item));
  return key ? messages[key] : raw;
}

export default function PresenceKioskPage() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deviceRegistered, setDeviceRegistered] = useState(false);
  const [operatingDayStatus, setOperatingDayStatus] = useState<"open" | "closed" | "not_opened" | "unknown">("unknown");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AttendanceResult | null>(null);

  useEffect(() => {
    fetch("/api/presence/kiosk-status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { setDeviceRegistered(Boolean(payload.activated)); setOperatingDayStatus(["open","closed","not_opened"].includes(payload.dayStatus) ? payload.dayStatus : "unknown"); })
      .catch(() => setDeviceRegistered(false));

    let alive = true;
    async function refreshIdentity(nextUser: User | null) {
      if (!alive) return;
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const { data } = await supabase.from("user_roles").select("roles(code)").eq("user_id", nextUser.id);
      const roleCodes = (data ?? []).flatMap((entry: any) =>
        Array.isArray(entry.roles) ? entry.roles.map((role: any) => role.code) : entry.roles?.code ? [entry.roles.code] : []
      ).map((code: string) => code.toUpperCase());
      if (alive) {
        setIsAdmin(roleCodes.some((code: string) => ["DIRECTOR", "ADMIN", "PRE_ADMIN", "SECRETARIAT", "SECRETARY"].includes(code)));
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => void refreshIdentity(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void refreshIdentity(session?.user ?? null);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function activateKiosk() {
    setBusy(true);
    setMessage("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("AUTH_REQUIRED");
      const response = await fetch("/api/presence/kiosk-activate", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload?.activated) throw new Error(payload?.error || "KIOSK_ACTIVATION_FAILED");
      setDeviceRegistered(true);
      setOperatingDayStatus("open");
      setMessage("Journée ouverte et borne activée. Le jeton est conservé dans un cookie sécurisé inaccessible au JavaScript.");
    } catch (error) {
      setMessage(errorMessage(error instanceof Error ? error.message : "Activation impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeKiosk() {
    setBusy(true);
    setMessage("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("AUTH_REQUIRED");
      const response = await fetch("/api/presence/kiosk-revoke", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "KIOSK_REVOKE_FAILED");
      setDeviceRegistered(false);
      setOperatingDayStatus("closed");
      setMessage("Journée fermée. Les jetons actifs de borne sont révoqués et aucun nouveau pointage ne sera accepté.");
    } catch (error) {
      setMessage(errorMessage(error instanceof Error ? error.message : "Révocation impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    setPassword("");
    setIdentifier("");
    setResult(null);
    setBusy(false);
    setMessage("Déconnexion effectuée. La borne est prête pour l’apprenant suivant.");
  }

  async function loginLearner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      if (!deviceRegistered) throw new Error("KIOSK_NOT_REGISTERED");
      const { data: authPayload, error: authError } = await supabase.functions.invoke("kiosk-auth", {
        body: { identifier: identifier.trim(), password }
      });
      let failurePayload: { error?: string } | null = authPayload;
      if (authError) {
        const context = (authError as unknown as { context?: unknown }).context;
        if (context instanceof Response) {
          try { failurePayload = await context.clone().json(); } catch { failurePayload = null; }
        }
      }
      if (authError || !authPayload?.access_token || !authPayload?.refresh_token) {
        const detail = failurePayload?.error || (authError ? "INVALID_CREDENTIALS" : "SERVICE_UNAVAILABLE");
        throw new Error(detail);
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: authPayload.access_token,
        refresh_token: authPayload.refresh_token
      });
      if (sessionError || !sessionData.user) throw new Error("Connexion impossible.");
      const signedInUser = sessionData.user;

      const { data: profile, error: profileError } = await supabase.from("profiles").select("status").eq("id", signedInUser.id).maybeSingle();
      const { data: rolesData } = await supabase.from("user_roles").select("roles(code)").eq("user_id", signedInUser.id);
      const roleCodes = (rolesData ?? []).flatMap((entry: any) =>
        Array.isArray(entry.roles) ? entry.roles.map((role: any) => role.code) : entry.roles?.code ? [entry.roles.code] : []
      ).map((code: string) => code.toUpperCase());

      if (profileError || String(profile?.status ?? "").trim().toLowerCase() !== "active" || roleCodes.some((code: string) => ["DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(code))) {
        await supabase.auth.signOut();
        throw new Error("Ce compte n’est pas autorisé à pointer comme apprenant actif.");
      }

      setUser(signedInUser);
      setPassword("");
      setMessage("Connexion réussie. Appuyez sur le bouton pour demander la validation de votre présence.");
    } catch (error) {
      setMessage(errorMessage(error instanceof Error ? error.message : "Connexion impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function recordPresence() {
    if (!deviceRegistered || !user) {
      setMessage("La borne doit être activée et l’apprenant doit être connecté.");
      return;
    }
    setBusy(true);
    setMessage("");
    setResult(null);

    const submit = async (coords?: GeolocationPosition) => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("AUTH_REQUIRED");
        const gps = coords ? {
          latitude: coords.coords.latitude,
          longitude: coords.coords.longitude,
          accuracy: coords.coords.accuracy,
        } : {};
        const response = await fetch("/api/presence/kiosk-checkin", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(gps),
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Le serveur n’a pas confirmé le pointage.");
        setResult(payload);
        setMessage(payload.duplicate ? "Votre présence avait déjà été enregistrée aujourd’hui." : "Pointage confirmé par le serveur.");
      } catch (error) {
        setMessage(errorMessage(error instanceof Error ? error.message : "Pointage impossible."));
      } finally {
        await supabase.auth.signOut();
        setPassword("");
        setIdentifier("");
        setUser(null);
        setBusy(false);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => void submit(position),
        () => void submit(),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      await submit();
    }
  }

  const timestamp = result?.arrived_at
    ? new Date(result.arrived_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Porto-Novo" })
    : "";

  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fa", color: "#15243a", padding: "28px 16px", fontFamily: "Arial, sans-serif" }}>
      <section style={{ maxWidth: 620, margin: "0 auto", background: "#fff", border: "1px solid #dce4ef", borderRadius: 18, padding: 24, boxShadow: "0 8px 30px rgba(24,48,80,.08)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 76, height: 64, objectFit: "contain" }} />
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: "#45627f" }}>AÉRO SERVICE</p>
            <h1 style={{ margin: 0, fontSize: 26 }}>Borne officielle de présence</h1>
            <p style={{ margin: "5px 0 0", color: "#52647a" }}>Ordinateur du centre · tablette compatible</p>
          </div>
        </header>
        <nav style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginBottom: 18 }}>
          <a href="/presence/qr-affiche" style={navLinkStyle}>QR officiel à imprimer</a>
          <a href="/presence/secretariat" style={navLinkStyle}>File du secrétariat</a>
        </nav>

        {loading ? <p role="status">Vérification de la session…</p> : null}

        {!loading && user && isAdmin && (
          <div style={{ border: "1px solid #dce4ef", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Configuration de la borne</h2>
            <p style={{ lineHeight: 1.5, color: "#52647a" }}>Réservé à la Direction, à la pré-administration et au secrétariat autorisé. La secrétaire peut ouvrir la journée, créer le jeton et activer la borne, puis fermer la journée en fin de service. Cela ne lui donne pas les autres droits de Direction. La fermeture révoque les jetons actifs.</p>
            {deviceRegistered ? (
              <>
                <p style={{ color: "#17663b", fontWeight: 700 }}>Cette session possède déjà un jeton de borne.</p>
                <button type="button" onClick={() => void signOut()} disabled={busy} style={primaryButton}>Terminer la configuration et ouvrir le pointage apprenant</button>
                <button type="button" onClick={() => void revokeKiosk()} disabled={busy} style={secondaryButton}>Fermer la journée et révoquer la borne</button>
              </>
            ) : operatingDayStatus === "closed" ? (
              <p role="status" style={{ color: "#8f2020", lineHeight: 1.5 }}>La journée est déjà fermée. Les jetons de borne sont révoqués; une nouvelle ouverture sera possible le prochain jour ouvrable.</p>
            ) : (
              <button type="button" onClick={() => void activateKiosk()} disabled={busy} style={primaryButton}>{busy ? "Ouverture en cours…" : "Ouvrir la journée et activer cette borne"}</button>
            )}
          </div>
        )}

        {!loading && !user && (
          <div style={{ border: "1px solid #dce4ef", borderRadius: 12, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Pointage apprenant</h2>
            {!deviceRegistered ? (
              <p role="alert" style={{ color: "#8f2020", lineHeight: 1.5 }}>Cette borne n’est pas activée. Connectez-vous avec un compte Direction, PRE_ADMIN ou secrétariat autorisé sur la plateforme, puis ouvrez cette page pour enregistrer l’appareil.</p>
            ) : (
              <>
                <p style={{ color: "#52647a", lineHeight: 1.5 }}>Présentez-vous à la borne officielle. Le pointage personnel depuis un téléphone n’est pas autorisé. Le GPS est un contrôle complémentaire quand il est disponible.</p>
                <form onSubmit={loginLearner} style={{ display: "grid", gap: 12 }}>
                  <label style={labelStyle}>E-mail ou identifiant apprenant
                    <input autoComplete="username" type="text" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} style={inputStyle} placeholder="E-mail ou matricule apprenant" />
                  </label>
                  <label style={labelStyle}>Mot de passe
                    <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} />
                  </label>
                  <button type="submit" disabled={busy} style={primaryButton}>{busy ? "Connexion…" : "Se connecter"}</button>
                </form>
              </>
            )}
          </div>
        )}

        {!loading && user && !isAdmin && (
          <div style={{ border: "1px solid #dce4ef", borderRadius: 12, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Confirmer votre présence</h2>
            <p style={{ lineHeight: 1.5 }}>Connecté : <strong>{user.email || "compte apprenant"}</strong></p>
            <p style={{ color: "#52647a", lineHeight: 1.5 }}>Le serveur vérifiera votre compte apprenant, la borne autorisée, l’horaire et l’absence de doublon.</p>
            <button type="button" onClick={() => void recordPresence()} disabled={busy || !deviceRegistered} style={primaryButton}>{busy ? "Vérification…" : "Je suis présent — valider"}</button>
            <button type="button" onClick={() => void signOut()} disabled={busy} style={secondaryButton}>Ce n’est pas mon compte / Annuler</button>
          </div>
        )}

        {message && <p role="status" style={{ marginTop: 16, padding: 13, borderRadius: 10, background: message.includes("impossible") || message.includes("incorrects") || message.includes("n’est pas") ? "#fff0f0" : "#eaf7ef", color: message.includes("impossible") || message.includes("incorrects") || message.includes("n’est pas") ? "#8f2020" : "#17663b", lineHeight: 1.5 }}>{message}</p>}
        {result && (
          <div role="status" style={{ marginTop: 12, padding: 14, borderRadius: 12, background: result.duplicate ? "#fff7e6" : result.status === "late" ? "#fff0f0" : "#eaf7ef", lineHeight: 1.5 }}>
            <strong>{result.duplicate ? "Présence déjà enregistrée" : "Présence enregistrée"}</strong>
            <p style={{ margin: "6px 0" }}>Statut : {result.status === "late" ? "En retard" : "À l’heure"}</p>
            {timestamp && <p style={{ margin: "6px 0" }}>Heure officielle : {timestamp}</p>}
          </div>
        )}

        <p style={{ margin: "20px 0 0", fontSize: 12, color: "#66778b", lineHeight: 1.5 }}>Ne laissez pas cette page ouverte sans surveillance. Après chaque tentative de pointage, le compte apprenant est déconnecté automatiquement. Le secret de la borne est conservé dans un cookie HttpOnly sécurisé, inaccessible au JavaScript de la page.</p>
      </section>
    </main>
  );
}

const primaryButton: React.CSSProperties = { width: "100%", border: 0, borderRadius: 10, padding: "13px 16px", background: "#174ea6", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 8 };
const secondaryButton: React.CSSProperties = { width: "100%", border: "1px solid #c7d4e4", borderRadius: 10, padding: "12px 16px", background: "#fff", color: "#243b53", fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 8 };
const labelStyle: React.CSSProperties = { display: "grid", gap: 6, fontSize: 14, fontWeight: 700 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 13px", borderRadius: 9, border: "1px solid #c7d4e4", fontSize: 16, boxSizing: "border-box" };

const navLinkStyle: React.CSSProperties = { display: "block", textAlign: "center", padding: "10px 12px", borderRadius: 9, border: "1px solid #c7d4e4", color: "#174ea6", fontSize: 13, fontWeight: 700, textDecoration: "none" };
