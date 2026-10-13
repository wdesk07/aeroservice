export default function DisabledQrPresencePage() {
  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fa", color: "#15243a", padding: "28px 16px", fontFamily: "Arial, sans-serif" }}>
      <section style={{ maxWidth: 520, margin: "0 auto", background: "#fff", border: "1px solid #dce4ef", borderRadius: 18, padding: 24, boxShadow: "0 8px 30px rgba(24,48,80,.08)" }}>
        <img src="/logo-aero-services.jpg" alt="Logo Aéro Service" style={{ width: 88, height: 72, objectFit: "contain", marginBottom: 12 }} />
        <p style={{ margin: "0 0 6px", fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: "#45627f" }}>AÉRO SERVICE</p>
        <h1 style={{ fontSize: 25, lineHeight: 1.2 }}>Le pointage QR est désactivé</h1>
        <p style={{ color: "#52647a", lineHeight: 1.6 }}>Aéro Service utilise désormais la borne officielle du centre comme méthode de pointage prioritaire. Le QR code public ne permet pas d’enregistrer une présence.</p>
        <a href="/presence/borne" style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 18, borderRadius: 10, padding: "14px 16px", background: "#174ea6", color: "#fff", fontSize: 16, fontWeight: 700 }}>Ouvrir la borne officielle</a>
        <a href="/" style={{ display: "block", textAlign: "center", marginTop: 14, color: "#174ea6", fontWeight: 700 }}>Retour à Aéro Service</a>
      </section>
    </main>
  );
}
