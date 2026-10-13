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
    KIOSK_ADMIN_REQUIRED: "Seule la Direction ou la pré-administration peut activer une borne.",
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
  const [deviceToken, setDeviceToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AttendanceResult | null>(null);

  useEffect(() => {
    const storedToken = window.sessionStorage.getItem("aero-presence-kiosk-token") || "";
    const storedDeviceId = window.sessionStorage.getItem("aero-presence-kiosk-device-id") || "";
    setDeviceToken(storedToken);
    setDeviceId(storedDeviceId);

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
        setIsAdmin(roleCodes.some((code: string) => ["DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(code)));
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
      const { data, error } = await supabase.rpc("activate_presence_kiosk", { p_name: "Borne officielle Aéro Service" });
      if (error) throw new Error(error.message);
      const payload = data as { ok?: boolean; device_token?: string; device_id?: string; device_name?: string };
      if (!payload?.ok || !payload.device_token || !payload.device_id) throw new Error("Le serveur n’a pas confirmé l’activation.");
      window.sessionStorage.setItem("aero-presence-kiosk-token", payload.device_token);
      window.sessionStorage.setItem("aero-presence-kiosk-device-id", payload.device_id);
      setDeviceToken(payload.device_token);
      setDeviceId(payload.device_id);
      setMessage("Borne activée sur cet appareil. Le code secret a été enregistré dans cette session du navigateur.");
    } catch (error) {
      setMessage(errorMessage(error instanceof Error ? error.message : "Activation impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeKiosk() {
    if (!deviceId) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.rpc("revoke_presence_kiosk", { p_device_id: deviceId });
      if (error) throw new Error(error.message);
      window.sessionStorage.removeItem("aero-presence-kiosk-token");
      window.sessionStorage.removeItem("aero-presence-kiosk-device-id");
      setDeviceToken("");
      setDeviceId("");
      setMessage("Borne révoquée. Aucun nouveau pointage ne sera accepté depuis cet appareil.");
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
      if (!deviceToken) throw new Error("KIOSK_NOT_REGISTERED");
      const { data: authPayload, error: authError } = await supabase.functions.invoke("kiosk-auth", {
        body: { identifier: identifier.trim(), password }
      });
      if (authError || !authPayload?.access_token || !authPayload?.refresh_token) {
        const detail = authPayload?.error || authError?.message || "Invalid login credentials";
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

      if (profileError || profile?.status !== "active" || roleCodes.some((code: string) => ["DIRECTOR", "ADMIN", "PRE_ADMIN"].includes(code))) {
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
    if (!deviceToken || !user) {
      setMessage("La borne doit être activée et l’apprenant doit être connecté.");
      return;
    }
    setBusy(true);
    setMessage("");
    setResult(null);

    const submit = async (coords?: GeolocationPosition) => {
      try {
        const args: Record<string, unknown> = { p_device_token: deviceToken };
        if (coords) {
          args.p_lat = coords.coords.latitude;
          args.p_lng = coords.coords.longitude;
          args.p_accuracy_m = coords.coords.accuracy;
        }
        const { data, error } = await supabase.rpc("kiosk_daily_checkin", args);
        if (error) throw new Error(error.message);
        const payload = data as AttendanceResult;
        if (!payload?.ok) throw new Error("Le serveur n’a pas confirmé le pointage.");
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
          <img src="/logo-aero-services.jpg" alt="Logo Aéro Service" style={{ width: 76, height: 64, objectFit: "contain" }} />
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: "#45627f" }}>AÉRO SERVICE</p>
            <h1 style={{ margin: 0, fontSize: 26 }}>Borne officielle de présence</h1>
            <p style={{ margin: "5px 0 0", color: "#52647a" }}>Ordinateur du centre · tablette compatible</p>
          </div>
        </header>

        {loading ? <p role="status">Vérification de la session…</p> : null}

        {!loading && user && isAdmin && (
          <div style={{ border: "1px solid #dce4ef", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Configuration de la borne</h2>
            <p style={{ lineHeight: 1.5, color: "#52647a" }}>Réservé à la Direction et à la pré-administration. L’activation lie cette session du navigateur à un dispositif autorisé.</p>
            {deviceToken ? (
              <>
                <p style={{ color: "#17663b", fontWeight: 700 }}>Cette session possède déjà un jeton de borne.</p>
                <button type="button" onClick={() => void signOut()} disabled={busy} style={primaryButton}>Terminer la configuration et ouvrir le pointage apprenant</button>
                <button type="button" onClick={() => void revokeKiosk()} disabled={busy} style={secondaryButton}>Révoquer cette borne</button>
              </>
            ) : (
              <button type="button" onClick={() => void activateKiosk()} disabled={busy} style={primaryButton}>{busy ? "Activation…" : "Activer cet ordinateur comme borne"}</button>
            )}
          </div>
        )}

        {!loading && !user && (
          <div style={{ border: "1px solid #dce4ef", borderRadius: 12, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Pointage apprenant</h2>
            {!deviceToken ? (
              <p role="alert" style={{ color: "#8f2020", lineHeight: 1.5 }}>Cette borne n’est pas activée. Connectez-vous avec un compte Direction ou PRE_ADMIN sur la plateforme, puis ouvrez cette page pour enregistrer l’appareil.</p>
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
            <button type="button" onClick={() => void recordPresence()} disabled={busy || !deviceToken} style={primaryButton}>{busy ? "Vérification…" : "Je suis présent — valider"}</button>
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

        <p style={{ margin: "20px 0 0", fontSize: 12, color: "#66778b", lineHeight: 1.5 }}>Ne laissez pas cette page ouverte sans surveillance. Après chaque tentative de pointage, le compte apprenant est déconnecté automatiquement. Le code de borne reste limité à cette session de navigateur.</p>
      </section>
    </main>
  );
}

const primaryButton: React.CSSProperties = { width: "100%", border: 0, borderRadius: 10, padding: "13px 16px", background: "#174ea6", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 8 };
const secondaryButton: React.CSSProperties = { width: "100%", border: "1px solid #c7d4e4", borderRadius: 10, padding: "12px 16px", background: "#fff", color: "#243b53", fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 8 };
const labelStyle: React.CSSProperties = { display: "grid", gap: 6, fontSize: 14, fontWeight: 700 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 13px", borderRadius: 9, border: "1px solid #c7d4e4", fontSize: 16, boxSizing: "border-box" };
