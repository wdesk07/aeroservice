"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
type Penalty = { id: string; person_id: string; amount_fcfa: number; status: string; penalty_type: string; description: string | null; created_at: string; };
type Payment = { id: string; person_id: string; penalty_id: string | null; amount_fcfa: number; status: string; payment_category: string | null; payment_type: string | null; received_at: string | null; receipt_number: string | null; };
type Student = { id: string; formation_id: string | null; group_id: string | null; student_number: string | null; };
type StudentGroup = { id: string; formation_id: string | null; name: string; };
type Formation = { id: string; name: string; code: string | null; };
type Summary = { id: string; name: string; count: number; due: number; paid: number; outstanding: number; };
const money = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} FCFA`;
const panel: React.CSSProperties = { background: "#fff", border: "1px solid #dce4ef", borderRadius: 15, padding: 18, boxShadow: "0 4px 18px rgba(20,42,70,.04)" };
const muted: React.CSSProperties = { color: "#63738a", fontSize: 13, lineHeight: 1.5 };
const btn: React.CSSProperties = { border: "1px solid #cbd5e1", borderRadius: 9, padding: "9px 12px", background: "#fff", color: "#174ea6", fontWeight: 700, cursor: "pointer", textDecoration: "none" };

export default function DirectorFinancesPage() {
  const [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [formationFilter, setFormationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "due" | "paid">("all");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) { setAuthorized(false); setReady(true); setBusy(false); return; }
    const { data: roleRows, error: roleError } = await supabase.from("user_roles").select("roles(code)").eq("user_id", user.id);
    const codes = (roleRows ?? []).flatMap((item: any) => Array.isArray(item.roles) ? item.roles : item.roles ? [item.roles] : []).map((role: any) => String(role.code).toUpperCase());
    if (roleError || !["DIRECTOR", "ADMIN", "PRE_ADMIN"].some((code) => codes.includes(code))) { setAuthorized(false); setReady(true); setBusy(false); return; }
    setAuthorized(true); setReady(true);
    const [p, pay, s, g, f] = await Promise.all([
      supabase.from("penalties").select("id,person_id,amount_fcfa,status,penalty_type,description,created_at").limit(5000),
      supabase.from("payments").select("id,person_id,penalty_id,amount_fcfa,status,payment_category,payment_type,received_at,receipt_number").limit(5000),
      supabase.from("students").select("id,formation_id,group_id,student_number").limit(5000),
      supabase.from("groups").select("id,formation_id,name").limit(2000),
      supabase.from("formations").select("id,name,code").limit(1000)
    ]);
    const failures = [p.error, pay.error, s.error, g.error, f.error].filter(Boolean);
    if (failures.length) setError("Une partie des données financières est inaccessible. Vérifiez les autorisations de lecture sur TEST. " + failures.map((e: any) => e.message).join(" · "));
    setPenalties((p.data ?? []) as Penalty[]);
    setPayments((pay.data ?? []) as Payment[]);
    setStudents((s.data ?? []) as Student[]);
    setGroups((g.data ?? []) as StudentGroup[]);
    setFormations((f.data ?? []) as Formation[]);
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const summaries = useMemo(() => {
    const studentById = new Map(students.map((student) => [student.id, student]));
    const formationById = new Map(formations.map((formation) => [formation.id, formation]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const result = new Map<string, Summary>();
    for (const penalty of penalties) {
      const student = studentById.get(penalty.person_id);
      const group = student?.group_id ? groupById.get(student.group_id) : null;
      const formationId = student?.formation_id ?? group?.formation_id ?? null;
      const formation = formationId ? formationById.get(formationId) : null;
      const id = formation?.id ?? (student ? "unassigned" : "staff");
      const name = formation?.name ?? (student ? "Formation non renseignée" : "Personnel / hors formation");
      const item = result.get(id) ?? { id, name, count: 0, due: 0, paid: 0, outstanding: 0 };
      const linkedValidatedPayments = payments.filter((payment) => payment.penalty_id === penalty.id && payment.status.toLowerCase() === "validated").reduce((sum, payment) => sum + Number(payment.amount_fcfa || 0), 0);
      const paidAmount = penalty.status.toLowerCase() === "paid" ? Number(penalty.amount_fcfa || 0) : Math.min(Number(penalty.amount_fcfa || 0), linkedValidatedPayments);
      item.count += 1;
      item.due += Number(penalty.amount_fcfa || 0);
      item.paid += paidAmount;
      item.outstanding += Math.max(0, Number(penalty.amount_fcfa || 0) - paidAmount);
      result.set(id, item);
    }
    return [...result.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [penalties, payments, students, groups, formations]);

  const visibleSummaries = summaries.filter((item) => (formationFilter === "all" || item.id === formationFilter) && (statusFilter === "all" || (statusFilter === "due" ? item.outstanding > 0 : item.outstanding === 0)));
  const totals = summaries.reduce((all, item) => ({ count: all.count + item.count, due: all.due + item.due, paid: all.paid + item.paid, outstanding: all.outstanding + item.outstanding }), { count: 0, due: 0, paid: 0, outstanding: 0 });
  const penaltyPayments = payments.filter((payment) => payment.status.toLowerCase() === "validated" && (payment.penalty_id || payment.payment_category?.toLowerCase() === "penalty" || payment.payment_type?.toLowerCase() === "penalty")).reduce((sum, payment) => sum + Number(payment.amount_fcfa || 0), 0);

  if (!ready || busy) return <main style={{ minHeight: "100vh", padding: 24, background: "#f3f6fa", color: "#172b45" }}><section style={{ ...panel, maxWidth: 1000, margin: "0 auto" }}>Chargement du point financier…</section></main>;
  if (!authorized) return <main style={{ minHeight: "100vh", padding: 24, background: "#f3f6fa", color: "#172b45" }}><section style={{ ...panel, maxWidth: 680, margin: "0 auto" }}><img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 92, height: 64, objectFit: "contain" }} /><h1>Point financier réservé à la Direction</h1><p>Connectez-vous avec un compte Direction, ADMIN ou PRE_ADMIN.</p><a href="/">Retour à Aéro Service</a></section></main>;

  return <main style={{ minHeight: "100vh", padding: 24, background: "#f3f6fa", color: "#172b45", fontFamily: "Arial,sans-serif" }}>
    <header style={{ maxWidth: 1120, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}><img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" style={{ width: 72, height: 56, objectFit: "contain" }} /><div><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: "#48617f" }}>DIRECTION · FINANCES</div><h1 style={{ margin: "5px 0", fontSize: 30 }}>Point financier</h1><p style={{ ...muted, margin: 0 }}>Pénalités de retard et d’absence : montants dus, réglés et restant à payer.</p></div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><a href="/" style={btn}>← Tableau de bord</a><button style={{ ...btn, background: "#174ea6", color: "#fff" }} onClick={() => void load()}>Actualiser</button></div>
    </header>
    <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 16 }}>
      {error && <div role="alert" style={{ padding: 13, borderRadius: 10, color: "#922", background: "#fff0f0", border: "1px solid #f2c7c7" }}>{error}</div>}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
        {[["Pénalités", String(totals.count)],["Montant total dû",money(totals.due)],["Montant régularisé",money(totals.paid)],["Reste à payer",money(totals.outstanding)],["Règlements validés",money(penaltyPayments)]].map(([label,value])=><article key={label} style={panel}><div style={muted}>{label}</div><strong style={{ display: "block", marginTop: 8, fontSize: 23 }}>{value}</strong></article>)}
      </section>
      <section style={panel}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", justifyContent: "space-between" }}><div><h2 style={{ margin: "0 0 5px", fontSize: 19 }}>Suivi par formation</h2><p style={{ ...muted, margin: 0 }}>Les montants proviennent des pénalités enregistrées et des paiements validés associés.</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Formation<select style={{ ...btn, minWidth: 190 }} value={formationFilter} onChange={(e) => setFormationFilter(e.target.value)}><option value="all">Toutes les formations</option>{summaries.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>Règlement<select style={btn} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Tous</option><option value="due">Reste à payer</option><option value="paid">Tout réglé</option></select></label></div></div>
        {visibleSummaries.length === 0 ? <p style={muted}>Aucune pénalité ne correspond à ce filtre.</p> : <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700, fontSize: 13 }}><thead><tr>{["Formation / catégorie","Nombre de pénalités","Montant dû","Montant réglé","Reste à payer"].map((label)=><th key={label} style={{ padding: 11, textAlign: "left", borderBottom: "1px solid #dce4ef", color: "#53657c" }}>{label}</th>)}</tr></thead><tbody>{visibleSummaries.map((item)=><tr key={item.id}><td style={{ padding: 12, borderBottom: "1px solid #edf1f6", fontWeight: 700 }}>{item.name}</td><td style={{ padding: 12, borderBottom: "1px solid #edf1f6" }}>{item.count}</td><td style={{ padding: 12, borderBottom: "1px solid #edf1f6" }}>{money(item.due)}</td><td style={{ padding: 12, borderBottom: "1px solid #edf1f6", color: "#17633a" }}>{money(item.paid)}</td><td style={{ padding: 12, borderBottom: "1px solid #edf1f6", color: item.outstanding ? "#9a2727" : "#17633a", fontWeight: 700 }}>{money(item.outstanding)}</td></tr>)}</tbody></table></div>}
      </section>
      <section style={panel}><h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Comment lire ces chiffres</h2><p style={muted}>Un paiement est considéré comme réglé uniquement si le paiement lié à la pénalité est validé par le secrétariat, ou si la pénalité porte déjà le statut « payé ». Les paiements ordinaires sans lien avec une pénalité ne sont pas ajoutés au total des pénalités.</p></section>
    </div>
  </main>;
}
