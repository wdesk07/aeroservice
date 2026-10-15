"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export default function QrPosterPage() {
  const [targetUrl, setTargetUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);\n  const [qrReady, setQrReady] = useState(false);\n  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function verifyAccess() {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentUser = sessionData.session?.user;
      if (!currentUser) {
        if (alive) setCheckingAccess(false);
        return;
      }
      const { data } = await supabase.from("user_roles").select("roles(code)").eq("user_id", currentUser.id);
      const codes = (data ?? []).flatMap((entry: any) =>
        Array.isArray(entry.roles) ? entry.roles.map((role: any) => role.code) : entry.roles?.code ? [entry.roles.code] : []
      ).map((code: string) => String(code).toUpperCase());
      const allowed = codes.some((code: string) => ["DIRECTOR", "ADMIN", "PRE_ADMIN", "SECRETARIAT", "SECRETARY", "SECRETAIRE", "SECRÉTAIRE"].includes(code));
      if (alive) {
        setAuthorized(allowed);
        setCheckingAccess(false);
        if (allowed) setTargetUrl(window.location.origin + "/presence/qr");
      }
    }
    void verifyAccess();
    return () => { alive = false; };
  }, []);

  const qrImage = targetUrl
    ? "https://api.qrserver.com/v1/create-qr-code/?size=360x360&format=png&margin=12&data=" + encodeURIComponent(targetUrl)
    : "";

  if (checkingAccess || !authorized) {
    return (
      <main style={{ minHeight: "100vh", background: "#eef2f7", color: "#15243a", padding: 24, fontFamily: "Arial,sans-serif" }}>
        <section style={{ maxWidth: 560, margin: "8vh auto", padding: 28, borderRadius: 16, background: "#fff", border: "1px solid #d4deeb", textAlign: "center" }}>
          <img src="/aero-service-logo.svg" alt="Logo Aéro Service" style={{ width: 90, height: 70, objectFit: "contain" }} />
          <h1 style={{ marginBottom: 8 }}>QR officiel du centre</h1>
          <p style={{ lineHeight: 1.6, color: "#52647a" }}>{checkingAccess ? "Vérification de vos autorisations…" : "L’impression du QR officiel est réservée à la Direction, à la pré-administration et au secrétariat. Connectez-vous avec un compte autorisé."}</p>
          {!checkingAccess && <a href="/" style={{ display: "inline-block", marginTop: 8, color: "#174ea6", fontWeight: 700 }}>Se connecter à Aéro Service</a>}
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#eef2f7", color: "#15243a", padding: 24, fontFamily: "Arial,sans-serif" }}>
      <style>{`@media print { body { background: #fff !important; } .no-print { display:none !important; } .poster { box-shadow:none !important; border:2px solid #15243a !important; } }`}</style>
      <div className="no-print" style={{ maxWidth: 760, margin: "0 auto 16px", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <a href="/presence/secretariat" style={{ color: "#174ea6", fontWeight: 700, textDecoration: "none" }}>← Espace secrétariat</a>
        <button onClick={printOnlyWhenQrReady} disabled={!qrReady} style={{ border: 0, borderRadius: 10, padding: "12px 18px", background: qrReady ? "#174ea6" : "#8193aa", color: "#fff", fontWeight: 700, cursor: qrReady ? "pointer" : "not-allowed" }}>Imprimer l’affiche QR</button>
      </div>
      <section className="poster" style={{ maxWidth: 760, margin: "0 auto", background: "#fff", border: "1px solid #d4deeb", borderRadius: 20, padding: "34px 28px", textAlign: "center", boxShadow: "0 8px 30px rgba(24,48,80,.08)" }}>
        <img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" style={{ width: 112, height: 90, objectFit: "contain" }} />
        <p style={{ margin: "10px 0 6px", fontSize: 14, letterSpacing: 2, fontWeight: 800, color: "#45627f" }}>AÉRO SERVICE</p>
        <h1 style={{ margin: "0 auto 10px", fontSize: 32, lineHeight: 1.15 }}>POINTAGE DES APPRENANTS</h1>
        <p style={{ margin: "0 auto 22px", maxWidth: 560, fontSize: 18, lineHeight: 1.45 }}>Scannez ce QR code avec votre téléphone, puis connectez-vous avec votre compte apprenant.</p>
        {qrImage ? <div style={{ width: 320, minHeight: 320, margin: "0 auto" }}>{!qrReady && <p className="no-print" style={{ color: qrFailed ? "#a32222" : "#52647a", fontWeight: 700 }}>{qrFailed ? "Le QR n’a pas pu être chargé. Vérifiez Internet puis actualisez la page." : "Chargement et vérification du QR code…"}</p>}<img src={qrImage} alt="QR code officiel de pointage Aéro Service" onLoad={() => { setQrReady(true); setQrFailed(false); }} onError={() => { setQrReady(false); setQrFailed(true); }} style={{ width: 300, height: 300, maxWidth: "100%", objectFit: "contain", imageRendering: "pixelated", display: qrReady ? "block" : "none", margin: "0 auto" }} /></div> : <div>Préparation du QR…</div>}
        <h2 style={{ margin: "18px 0 8px", fontSize: 22 }}>En retard ? Présentez-vous à la secrétaire.</h2>
        <p style={{ margin: "0 auto", maxWidth: 570, fontSize: 16, lineHeight: 1.5 }}>Votre demande de pointage est transmise au secrétariat. La présence physique doit être confirmée avant l’accès au cours. Si une pénalité est due, le paiement doit être validé par le secrétariat.</p>
        {targetUrl && <p style={{ margin: "18px auto 0", fontSize: 11, color: "#66778b", overflowWrap: "anywhere" }}>{targetUrl}</p>}
        <p style={{ margin: "22px 0 0", fontSize: 11, color: "#66778b" }}>Ne partagez pas votre mot de passe. Le QR code ne constitue pas à lui seul une preuve de présence.</p>
      </section>
      <p className="no-print" style={{ maxWidth: 760, margin: "14px auto 0", color: "#52647a", fontSize: 13, lineHeight: 1.5 }}>IMPORTANT : le bouton d’impression reste désactivé tant que l’image QR n’est pas chargée. Avant de coller l’affiche, scannez le QR imprimé avec un téléphone et vérifiez que l’adresse de pointage s’ouvre.</p>
    </main>
  );
}
