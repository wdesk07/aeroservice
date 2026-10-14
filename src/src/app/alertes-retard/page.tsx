"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type AlertRow = {
  id: string;
  title: string | null;
  body: string | null;
  type: string;
  status: string;
  created_at: string;
  data: Record<string, unknown> | null;
};

const allowedRoles = ["SECRETARIAT", "SECRETARY", "SECRETAIRE", "SECRÉTAIRE", "DIRECTOR", "ADMIN", "PRE_ADMIN"];

export default function LateAttendanceAlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [resolvedAttendanceIds, setResolvedAttendanceIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Vérification de la session…");
  const [denied, setDenied] = useState(false);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError("");
    setDenied(false);
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const currentUser = sessionData.session?.user;
    if (sessionError || !currentUser) {
      setAlerts([]);
      setMessage("Connectez-vous d’abord à Aéro Service, puis ouvrez cette page.");
      setLoading(false);
      return;
    }

    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("roles(code)")
      .eq("user_id", currentUser.id);

    if (roleError) {
      setAlerts([]);
      setError("Impossible de vérifier vos autorisations. Contactez le pré-administrateur.");
      setLoading(false);
      return;
    }

    const codes = (roleRows ?? []).flatMap((row: any) =>
      Array.isArray(row.roles)
        ? row.roles.map((role: any) => String(role.code ?? "").toUpperCase())
        : row.roles
          ? [String(row.roles.code ?? "").toUpperCase()]
          : []
    );

    if (!codes.some((code: string) => allowedRoles.includes(code))) {
      setAlerts([]);
      setDenied(true);
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from("notifications")
      .select("id,title,body,type,status,created_at,data")
      .eq("recipient_id", currentUser.id)
      .eq("type", "attendance_late")
      .order("created_at", { ascending: false })
      .limit(50);

    if (queryError) {
      setAlerts([]);
      setError("Les notifications n’ont pas pu être chargées. Vérifiez les droits de lecture de la table notifications.");
    } else {
      const loadedAlerts = (data ?? []) as AlertRow[];
      setAlerts(loadedAlerts);
      const attendanceIds = [...new Set(loadedAlerts.map(alert => typeof alert.data?.daily_attendance_id === "string" ? alert.data.daily_attendance_id : "").filter(Boolean))];
      if (attendanceIds.length) {
        const { data: linkedPenalties } = await supabase.from("penalties").select("id,daily_attendance_id,status").in("daily_attendance_id", attendanceIds);
        const penaltyRows = (linkedPenalties ?? []) as {id:string;daily_attendance_id:string|null;status:string}[];
        const resolved = penaltyRows.filter(row => ["paid","waived","validated","regularized"].includes(String(row.status).toLowerCase()));
        const unresolvedPenaltyIds = penaltyRows.filter(row => !resolved.includes(row)).map(row => row.id);
        let paidPenaltyIds: string[] = [];
        if (unresolvedPenaltyIds.length) {
          const { data: paidPayments } = await supabase.from("payments").select("penalty_id").in("penalty_id", unresolvedPenaltyIds).in("status", ["validated","paid","success"]);
          paidPenaltyIds = [...new Set((paidPayments ?? []).map((row: any) => String(row.penalty_id ?? "")).filter(Boolean))];
        }
        setResolvedAttendanceIds([...new Set([...resolved.map(row => String(row.daily_attendance_id ?? "")), ...penaltyRows.filter(row => paidPenaltyIds.includes(row.id)).map(row => String(row.daily_attendance_id ?? ""))].filter(Boolean))]);
      } else setResolvedAttendanceIds([]);
      setMessage("");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", color: "#172033", padding: "28px 16px", fontFamily: "Arial, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: "#52637a" }}>AÉRO SERVICE · SUIVI</div>
            <h1 style={{ margin: "8px 0", fontSize: 28 }}>Alertes de retard</h1>
            <p style={{ margin: 0, color: "#52637a" }}>Retards enregistrés par la borne de pointage et transmis aux comptes autorisés.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => void loadAlerts()} disabled={loading} style={{ border: "1px solid #ccd5e1", borderRadius: 8, padding: "10px 14px", background: "#fff", cursor: "pointer" }}>
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
            <a href="/" style={{ borderRadius: 8, padding: "10px 14px", background: "#173b68", color: "#fff", textDecoration: "none" }}>Retour à la plateforme</a>
          </div>
        </header>

        {message && !loading && <div style={{ padding: 16, background: "#fff", border: "1px solid #dbe3ed", borderRadius: 10, marginBottom: 16 }}>{message}</div>}
        {denied && <div role="alert" style={{ padding: 16, background: "#fff1f1", color: "#a61b1b", border: "1px solid #f2b8b8", borderRadius: 10, marginBottom: 16 }}>Accès refusé. Cette page est réservée au secrétariat, à la direction et aux administrateurs autorisés.</div>}
        {error && <div role="alert" style={{ padding: 16, background: "#fff1f1", color: "#a61b1b", border: "1px solid #f2b8b8", borderRadius: 10, marginBottom: 16 }}>{error}</div>}

        <section style={{ background: "#fff", border: "1px solid #dbe3ed", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: 16, borderBottom: "1px solid #e6ebf2", fontWeight: 800 }}>Historique des alertes · {alerts.length}</div>
          {loading ? <p style={{ padding: 18 }}>Chargement des notifications…</p> :
            alerts.length === 0 ? <p style={{ padding: 18, color: "#52637a" }}>Aucune alerte de retard n’est disponible pour ce compte. Les nouvelles alertes s’afficheront après un pointage en retard si le compte est destinataire.</p> :
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#f8fafc", textAlign: "left" }}>
                  {["État", "Alerte", "Reçue le", "Référence", "Actions"].map(label => <th key={label} style={{ padding: 12, fontSize: 12, color: "#52637a" }}>{label}</th>)}
                </tr></thead>
                <tbody>{alerts.map(alert => <tr key={alert.id} style={{ borderTop: "1px solid #e6ebf2" }}>
                  <td style={{ padding: 12 }}><span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", fontSize: 12, fontWeight: 700, background: resolvedAttendanceIds.includes(String(alert.data?.daily_attendance_id ?? "")) ? "#dcfce7" : alert.status === "read" ? "#fef3c7" : "#fee2e2", color: resolvedAttendanceIds.includes(String(alert.data?.daily_attendance_id ?? "")) ? "#166534" : alert.status === "read" ? "#92400e" : "#991b1b" }}>{resolvedAttendanceIds.includes(String(alert.data?.daily_attendance_id ?? "")) ? "Traité — paiement validé" : alert.status === "pending" ? "À traiter" : alert.status === "read" ? "Consultée" : alert.status}</span></td>
                  <td style={{ padding: 12 }}><strong>{alert.title ?? "Alerte de retard"}</strong><div style={{ marginTop: 5, lineHeight: 1.5 }}>{alert.body ?? ""}</div></td>
                  <td style={{ padding: 12, whiteSpace: "nowrap" }}>{new Date(alert.created_at).toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo" })}</td>
                  <td style={{ padding: 12, fontFamily: "monospace" }}>{typeof alert.data?.daily_attendance_id === "string" ? alert.data.daily_attendance_id.slice(0, 8) : "—"}</td>
                  <td style={{ padding: 12, minWidth: 190 }}>
                    {typeof alert.data?.person_id === "string" && alert.data.person_id ? <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                      <a href={`/?module=students&person_id=${encodeURIComponent(alert.data.person_id)}`} style={{ color: "#173b68", fontWeight: 700, textDecoration: "underline" }}>Ouvrir le dossier</a>
                      <a href={`/?module=payments&person_id=${encodeURIComponent(alert.data.person_id)}`} style={{ color: "#173b68", textDecoration: "underline" }}>Voir les paiements</a>
                    </div> : <span style={{ color: "#65748b" }}>Dossier non lié</span>}
                  </td>
                </tr>)}</tbody>
              </table>
            </div>}
        </section>
        <p style={{ marginTop: 16, color: "#65748b", fontSize: 12, lineHeight: 1.6 }}>« Ouvrir le dossier » affiche la fiche de l’apprenant dans le module Apprenants. « Voir les paiements » ouvre ses règlements existants pour consultation et validation par un rôle autorisé. Cette page ne valide pas elle-même de paiement et ne débloque pas directement l’accès aux cours.</p>
      </section>
    </main>
  );
}
