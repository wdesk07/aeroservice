"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient, type User } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type CheckinRequest = {
  request_id: string;
  person_id: string;
  person_name: string;
  student_number: string | null;
  session_id: string;
  formation_name: string | null;
  requested_at: string;
  planned_start: string;
  delay_minutes: number;
  status: string;
};

export default function SecretariatQrCheckinsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [requests, setRequests] = useState<CheckinRequest[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paymentAction, setPaymentAction] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("list_qr_checkin_requests");
    if (rpcError) {
      setRequests([]);
      setError(rpcError.message.includes("QR_CHECKIN_REVIEW_FORBIDDEN")
        ? "Accès réservé à la Direction, à la pré-administration et au secrétariat autorisé."
        : "Impossible de charger la file de pointage. Vérifiez que la migration QR est appliquée.");
    } else {
      setRequests((data ?? []) as CheckinRequest[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { void loadRequests(); }, 5000);
    return () => window.clearInterval(timer);
  }, [loadRequests]);

  useEffect(() => {
    let alive = true;
    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const current = data.session?.user ?? null;
      setUser(current);
      if (!current) { setLoading(false); return; }
      const roleList = ["DIRECTOR","ADMIN","PRE_ADMIN","SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE"];
      const { data: kioskRole, error: kioskRoleError } = await supabase.rpc("kiosk_actor_has_role", { p_roles: roleList });
      let allowedRole: boolean | null = !kioskRoleError && kioskRole === true ? true : null;
      if (kioskRoleError) {
        const { data: legacyRole, error: legacyRoleError } = await supabase.rpc("has_any_role", { p_roles: roleList });
        if (!legacyRoleError) allowedRole = legacyRole === true;
        else {
          const { data: productionRole, error: productionRoleError } = await supabase.rpc("has_any_role", { role_codes: roleList });
          allowedRole = !productionRoleError && productionRole === true;
        }
      }
      const allowed = allowedRole === true;
      if (!alive) return;
      setAuthorized(allowed);
      if (allowed) await loadRequests();
      else setLoading(false);
    }
    void init();
    return () => { alive = false; };
  }, [loadRequests]);

  async function decide(item: CheckinRequest, decision: "approved" | "rejected") {
    setBusyId(item.request_id);
    setError("");
    setNotice("");
    setPaymentAction("");
    const { data, error: rpcError } = await supabase.rpc("review_qr_checkin_request", {
      p_request_id: item.request_id,
      p_decision: decision,
      p_comment: decision === "approved" ? "Présence physique vérifiée au secrétariat." : "Présence physique non confirmée."
    });
    if (rpcError || !data?.ok) {
      setError(rpcError?.message || "La décision n’a pas été enregistrée.");
    } else if (decision === "rejected") {
      setNotice("Demande refusée. Aucune présence ni pénalité n’a été créée.");
    } else {
      const delay = Number(data.delay_minutes ?? 0);
      const amount = Number(data.penalty_amount_fcfa ?? 0);
      setNotice(delay > 0
        ? "Présence confirmée. Retard : " + delay + " minute(s)." + (amount > 0 ? " Pénalité créée : " + amount.toLocaleString("fr-FR") + " FCFA. Le règlement doit être validé avant l’accès au cours." : " Aucune tranche de pénalité ne correspond à ce retard ; la Direction doit vérifier le barème dans Pénalités.") + " L’accès au cours reste bloqué jusqu’à régularisation."
        : "Présence confirmée à l’heure. Aucun règlement de pénalité n’est nécessaire.");
      if (delay > 0 && data.penalty_id && amount > 0) {
        const params = new URLSearchParams({ module: "payments", person_id: item.person_id, penalty_id: String(data.penalty_id), amount_fcfa: String(amount) });
        setPaymentAction("/?" + params.toString());
      } else if (delay > 0) {
        const params = new URLSearchParams({ module: "penalties", search: item.person_name });
        setPaymentAction("/?" + params.toString());
      }
    }
    setBusyId("");
    await loadRequests();
  }

  const localTime = (value: string) => new Date(value).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Porto-Novo" });

  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fa", color: "#15243a", padding: "24px 14px", fontFamily: "Arial,sans-serif" }}>
      <section style={{ maxWidth: 1000, margin: "0 auto", background: "#fff", border: "1px solid #dce4ef", borderRadius: 18, padding: 24, boxShadow: "0 8px 30px rgba(24,48,80,.08)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 68, height: 60, objectFit: "contain" }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: "#45627f" }}>AÉRO SERVICE · ADMINISTRATION</p>
            <h1 style={{ margin: 0, fontSize: 26 }}>Pointages QR à confirmer</h1>
            <p style={{ margin: "5px 0 0", color: "#52647a" }}>Vérifiez que l’apprenant est physiquement présent avant de confirmer.</p>
          </div>
          <button onClick={() => void loadRequests()} disabled={loading} style={secondaryButton}>↻ Actualiser</button>
        </header>
        <p style={{ margin: "0 0 16px" }}><a href="/" style={{ color: "#174ea6", fontWeight: 700, textDecoration: "none" }}>← Retour à l’espace principal</a></p>

        {!user && <div style={warningBox}>Connectez-vous d’abord à Aéro Service avec votre compte Direction ou secrétariat, puis revenez sur cette page.</div>}
        {user && !authorized && <div style={warningBox}>Votre compte n’a pas le rôle requis pour examiner les pointages QR.</div>}
        {notice && <div role="status" style={successBox}>{notice}{paymentAction && <div style={{ marginTop: 12 }}><a href={paymentAction} style={{ display: "inline-block", color: "#174ea6", fontWeight: 800, textDecoration: "underline" }}>{paymentAction.includes("module=payments") ? "Payer le retard — ouvrir le paiement prérempli" : "Consulter les pénalités de cet apprenant"}</a></div>}</div>}
        {error && <div role="alert" style={warningBox}>{error}</div>}

        {authorized && <p style={{ color: "#52647a", lineHeight: 1.55 }}>La demande QR seule ne crée pas de présence définitive. En confirmant ci-dessous, vous certifiez avoir vu l’apprenant. Le serveur crée ensuite le pointage et, si le barème le prévoit, la pénalité.</p>}

        {authorized && loading ? <p>Chargement des demandes…</p> : null}
        {authorized && !loading && requests.length === 0 && <div style={{ border: "1px dashed #c7d4e4", borderRadius: 12, padding: 24, textAlign: "center", color: "#52647a" }}>Aucune demande de pointage en attente.</div>}
        {authorized && requests.length > 0 && <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
          {requests.map((item) => (
            <article key={item.request_id} style={{ border: "1px solid #dce4ef", borderRadius: 13, padding: 16 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 260px" }}>
                  <h2 style={{ margin: "0 0 7px", fontSize: 18 }}>{item.person_name}</h2>
                  <p style={{ margin: "4px 0", color: "#52647a" }}>Matricule : <strong>{item.student_number || "Non renseigné"}</strong></p>
                  <p style={{ margin: "4px 0", color: "#52647a" }}>Formation : <strong>{item.formation_name || "Formation à vérifier"}</strong></p>
                  <p style={{ margin: "4px 0", color: "#52647a" }}>Demande reçue à {localTime(item.requested_at)} · Début prévu {localTime(item.planned_start)}</p>
                </div>
                <div style={{ minWidth: 150, borderRadius: 10, padding: 12, background: Number(item.delay_minutes) > 0 ? "#fff3cd" : "#eaf7ef", color: Number(item.delay_minutes) > 0 ? "#805b00" : "#17663b" }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>RETARD CALCULÉ</div>
                  <div style={{ fontSize: 25, fontWeight: 800 }}>{Number(item.delay_minutes)} min</div>
                  <div style={{ fontSize: 12 }}>{Number(item.delay_minutes) > 0 ? "À régulariser" : "À l’heure"}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginTop: 14 }}>
                <button disabled={Boolean(busyId)} onClick={() => void decide(item, "approved")} style={primaryButton}>{busyId === item.request_id ? "Traitement…" : "J’ai vu l’apprenant — confirmer"}</button>
                <button disabled={Boolean(busyId)} onClick={() => void decide(item, "rejected")} style={secondaryButton}>Refuser : absent physiquement</button>
              </div>
            </article>
          ))}
        </div>}

        <footer style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
          <a href="/" style={linkStyle}>Retour à Aéro Service</a>
          <a href="/presence/qr-affiche" style={linkStyle}>QR officiel à imprimer</a>
        </footer>
      </section>
    </main>
  );
}

const primaryButton: React.CSSProperties = { width: "100%", border: 0, borderRadius: 10, padding: "13px 16px", background: "#174ea6", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const secondaryButton: React.CSSProperties = { border: "1px solid #c7d4e4", borderRadius: 10, padding: "12px 16px", background: "#fff", color: "#243b53", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const warningBox: React.CSSProperties = { borderRadius: 10, padding: 14, background: "#fff0f0", color: "#8f2020", lineHeight: 1.55, marginBottom: 12 };
const successBox: React.CSSProperties = { borderRadius: 10, padding: 14, background: "#eaf7ef", color: "#17663b", lineHeight: 1.55, marginBottom: 12 };
const linkStyle: React.CSSProperties = { color: "#174ea6", fontWeight: 700, textDecoration: "none" };
