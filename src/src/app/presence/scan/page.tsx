"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

export default function LearnerQrScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "scanning" | "sending" | "done" | "error">("checking");
  const [message, setMessage] = useState("Vérification de votre connexion…");
  const [busy, setBusy] = useState(false);
  const [isPersonnel, setIsPersonnel] = useState(false);
  const [resultStatus, setResultStatus] = useState<"on_time" | "late" | null>(null);
  const [resultDelay, setResultDelay] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;
      if (error || !data.user) {
        setState("error");
        setMessage("Connectez-vous à votre espace apprenant avant de scanner le QR code.");
      } else {
        const { data: roleRows, error: roleError } = await supabase
          .from("user_roles").select("roles(code)").eq("user_id", data.user.id);
        const roles = (roleRows ?? []).flatMap((row: any) => {
          const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
          return role?.code ? [String(role.code).toUpperCase()] : [];
        });
        if (roleError || roles.length === 0) {
          setState("error");
          setMessage("Ce compte n’a aucun rôle actif autorisé pour le pointage. Contactez le secrétariat.");
          return;
        }
        const personnelRoles = ["DIRECTOR","ADMIN","PRE_ADMIN","SECRETARIAT","SECRETARY","SECRETAIRE","SECRÉTAIRE","STAFF","PERSONNEL","TEACHER","ENSEIGNANT","PEDAGOGY","PEDAGOGIE","ACCOUNTING","FINANCE"];
        const personnel = roles.some(role => personnelRoles.includes(role));
        setIsPersonnel(personnel);
        setState("ready");
        setMessage(personnel
          ? "Compte du personnel reconnu. Scannez le QR officiel affiché au centre. La localisation GPS du téléphone n’est plus nécessaire ; le serveur vérifie votre compte et l’horaire."
          : "Compte apprenant connecté. Scannez le QR officiel affiché au centre. Aucune localisation GPS ne sera demandée ; présentez-vous ensuite au secrétariat pour confirmer physiquement votre présence.");
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function startScan() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const detectorCtor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (!detectorCtor) throw new Error("Ce navigateur ne prend pas en charge le scan QR intégré. Ouvrez le site dans Chrome à jour.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("La caméra est indisponible. Autorisez l’accès à la caméra et utilisez HTTPS.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Caméra indisponible.");
      video.srcObject = stream;
      await video.play();
      const detector = new detectorCtor({ formats: ["qr_code"] });
      setState("scanning");
      setMessage("Pointez la caméra vers le QR officiel du centre.");
      let found = "";
      for (let i = 0; i < 90 && !found; i++) {
        const codes = await detector.detect(video);
        found = codes.find(code => code.rawValue)?.rawValue || "";
        if (!found) await new Promise(resolve => window.setTimeout(resolve, 180));
      }
      stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (!found) throw new Error("QR code non détecté. Réessayez en rapprochant la caméra.");
      const scanned = new URL(found, window.location.origin);
      const allowedPaths = isPersonnel
        ? ["/presence/personnel-qr", "/presence/personnel-qr/", "/presence/borne", "/presence/borne/"]
        : ["/presence/qr", "/presence/qr/"];
      if (!allowedPaths.includes(scanned.pathname) || scanned.origin !== window.location.origin) {
        throw new Error("Ce n’est pas le QR officiel de pointage Aéro Service.");
      }
      setState("sending");
      if (isPersonnel) {
        setMessage("QR reconnu. Vérification du compte, de l’horaire et du pointage (sans GPS)…");
        const { data, error } = await supabase.rpc("qr_daily_checkin_without_gps", {
          p_checkpoint_id: "a7c6e512-0f06-447e-b57b-8831d11f7ae9"
        });
        if (error) throw new Error(error.message);
        if (!data?.ok) throw new Error(data?.error || "Le serveur n’a pas confirmé le pointage.");
        setState("done");
        const late = String(data.status || "").toLowerCase() === "late";
        const minutes = Number(data.delay_minutes || 0);
        setResultStatus(late ? "late" : "on_time");
        setMessage(late
          ? "RETARD CONSTATÉ — Votre arrivée est enregistrée avec " + minutes + " minute(s) de retard. Les règles habituelles de régularisation s’appliquent."
          : "POINTAGE PERSONNEL CONFIRMÉ — Votre présence est enregistrée à l’heure.");
      } else {
        setMessage("QR reconnu. Envoi de votre demande de pointage sans localisation GPS…");
        const { data, error } = await supabase.rpc("request_qr_checkin_without_gps");
        if (error) throw new Error(error.message);
        if (!data?.ok) throw new Error(data?.error || "Le serveur n’a pas confirmé la demande.");
        setState("done");
        const delay = Math.max(0, Number(data.delay_minutes || 0));
        setResultDelay(delay);
        setResultStatus(delay > 0 ? "late" : "on_time");
        setMessage(delay > 0
          ? "PRÉSENT EN RETARD — " + delay + " minute(s) de retard constatées. Votre demande est envoyée au secrétariat pour confirmation physique. Le scan seul ne valide pas votre présence et ne donne pas accès au cours."
          : "PRÉSENT À L’HEURE — Votre demande de pointage est enregistrée à l’heure. Présentez-vous au secrétariat pour la confirmation physique. Le scan seul ne valide pas votre présence et ne donne pas accès au cours.");
      }
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Scan impossible. Réessayez.");
    } finally {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setBusy(false);
    }
  }

  return <main style={{ minHeight: "100vh", background: "#f3f6fa", color: "#15243a", padding: "24px 14px", fontFamily: "Arial,sans-serif" }}>
    <section style={{ maxWidth: 560, margin: "0 auto", background: "#fff", border: "1px solid #dce4ef", borderRadius: 18, padding: 24, boxShadow: "0 8px 30px rgba(24,48,80,.08)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <img src="/aero-service-logo.svg" alt="Logo officiel Aéro Service" style={{ width: 58, height: 58, objectFit: "contain" }} />
        <div><strong style={{ fontSize: 20 }}>AÉRO SERVICE</strong><div style={{ color: "#65758b", fontSize: 13 }}>Pointage par QR · apprenants et personnel</div></div>
      </header>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Scanner pour pointer</h1>
      <p role={state === "done" ? "status" : undefined} style={{ color: resultStatus === "on_time" ? "#166534" : resultStatus === "late" ? "#991b1b" : "#53647a", background: resultStatus === "on_time" ? "#dcfce7" : resultStatus === "late" ? "#fee2e2" : "transparent", border: resultStatus ? `1px solid ${resultStatus === "on_time" ? "#86efac" : "#fca5a5"}` : "1px solid transparent", borderRadius: 12, padding: resultStatus ? 16 : 0, fontWeight: resultStatus ? 800 : 400, fontSize: resultStatus ? 18 : 16, lineHeight: 1.6, textAlign: resultStatus ? "center" : "left" }}>{message}</p>
      <video ref={videoRef} playsInline muted style={{ display: state === "scanning" ? "block" : "none", width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 12, background: "#101828", margin: "16px 0" }} />
      {state === "ready" || state === "error" ? <button onClick={() => void startScan()} disabled={busy} style={{ width: "100%", padding: 14, border: 0, borderRadius: 10, background: "#1769d2", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 12 }}>Ouvrir la caméra et scanner</button> : null}
      {state === "done" ? <button onClick={() => { setState("ready"); setResultStatus(null); setResultDelay(0); setMessage("Vous pouvez scanner le QR officiel pour une nouvelle séance ou journée de service."); }} style={{ width: "100%", padding: 14, border: 0, borderRadius: 10, background: "#1769d2", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 12 }}>Terminé</button> : null}
      <p style={{ marginTop: 20 }}><Link href="/" style={{ color: "#1769d2", fontWeight: 700, textDecoration: "none" }}>← Retour à mon espace</Link></p>
    </section>
  </main>;
}
