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
        if (roleError || !roles.some(code => ["STUDENT", "APPRENANT"].includes(code))) {
          setState("error");
          setMessage("Cette fonction est réservée aux comptes apprenants actifs.");
          return;
        }
        setState("ready");
        setMessage("Compte apprenant connecté. Scannez le QR officiel affiché au centre.");
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
      if (scanned.origin !== window.location.origin || !["/presence/qr", "/presence/qr/"].includes(scanned.pathname)) {
        throw new Error("Ce n’est pas le QR officiel de pointage Aéro Service.");
      }
      setState("sending");
      setMessage("QR reconnu. Vérification de votre position et de la séance…");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          err => reject(new Error(err.code === err.PERMISSION_DENIED ? "Autorisez la localisation pour demander le pointage." : "Position GPS indisponible ou trop imprécise. Réessayez à l’extérieur.")),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      });
      const { data, error } = await supabase.rpc("request_qr_checkin_with_gps", {
        p_latitude: position.coords.latitude,
        p_longitude: position.coords.longitude,
        p_accuracy_m: Math.round(position.coords.accuracy)
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Le serveur n’a pas confirmé la demande.");
      setState("done");
      setMessage(data.duplicate
        ? "Une demande ou un pointage existe déjà pour cette séance."
        : "Demande de pointage transmise. Le secrétariat doit la confirmer avant qu’elle devienne une présence officielle.");
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
        <div><strong style={{ fontSize: 20 }}>AÉRO SERVICE</strong><div style={{ color: "#65758b", fontSize: 13 }}>Pointage apprenant par QR</div></div>
      </header>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Scanner pour pointer</h1>
      <p style={{ color: "#53647a", lineHeight: 1.6 }}>{message}</p>
      <video ref={videoRef} playsInline muted style={{ display: state === "scanning" ? "block" : "none", width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 12, background: "#101828", margin: "16px 0" }} />
      {state === "ready" || state === "error" ? <button onClick={() => void startScan()} disabled={busy} style={{ width: "100%", padding: 14, border: 0, borderRadius: 10, background: "#1769d2", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 12 }}>Ouvrir la caméra et scanner</button> : null}
      {state === "done" ? <button onClick={() => { setState("ready"); setMessage("Vous pouvez scanner le QR officiel pour une nouvelle séance."); }} style={{ width: "100%", padding: 14, border: 0, borderRadius: 10, background: "#1769d2", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 12 }}>Terminé</button> : null}
      <p style={{ marginTop: 20 }}><Link href="/" style={{ color: "#1769d2", fontWeight: 700, textDecoration: "none" }}>← Retour à mon espace</Link></p>
    </section>
  </main>;
}
