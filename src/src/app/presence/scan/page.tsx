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

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;
      if (error || !data.user) {
        setState("error");
        setMessage("Connectez-vous à votre espace avant de scanner le QR code.");
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
          ? "Compte du personnel reconnu. Scannez le QR officiel du centre ; la localisation sera demandée uniquement si la Direction l’a activée."
          : "Compte apprenant connecté. Scannez le QR officiel affiché au centre. La localisation dépend du réglage de la Direction ; la confirmation physique par le secrétariat reste obligatoire.");
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
      setMessage("QR reconnu. Vérification du compte, du réglage GPS et du pointage existant…");
      const { data: gpsRequired, error: gpsModeError } = await supabase.rpc("attendance_gps_enabled");
      if (gpsModeError) throw new Error(gpsModeError.message);
      let data: any;
      let error: any;
      if (gpsRequired === true) {
        if (!navigator.geolocation) throw new Error("GPS_REQUIRED");
        setMessage("La Direction exige la localisation. Vérification de votre position…");
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(
          resolve, () => reject(new Error("GPS_REQUIRED")),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        ));
        if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy <= 0 || position.coords.accuracy > 100) throw new Error("GPS_INVALID_OR_INACCURATE");
        const response = isPersonnel
          ? await supabase.rpc("request_personnel_qr_checkin_with_gps", { p_latitude: position.coords.latitude, p_longitude: position.coords.longitude, p_accuracy_m: position.coords.accuracy })
          : await supabase.rpc("request_qr_checkin_with_gps", { p_accuracy_m: position.coords.accuracy, p_latitude: position.coords.latitude, p_longitude: position.coords.longitude });
        data = response.data; error = response.error;
      } else {
        const response = await supabase.rpc(isPersonnel ? "request_personnel_qr_checkin_without_gps" : "request_qr_checkin_without_gps");
        data = response.data; error = response.error;
      }
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Le serveur n’a pas confirmé la demande.");
      setState("done");
      const status = String(data.status || "").toLowerCase();
      const hasDelay = data.delay_minutes !== null && data.delay_minutes !== undefined && Number.isFinite(Number(data.delay_minutes));
      const delay = hasDelay ? Number(data.delay_minutes) : null;
      const late = isPersonnel
        ? status === "late" || (hasDelay && delay! > 0)
        : data.late === true || status === "late" || (hasDelay && delay! > 15);
      const onTime = isPersonnel
        ? status === "on_time" || (hasDelay && delay === 0)
        : data.late === false || status === "on_time" || (hasDelay && delay! <= 15);
      const confirmedStatus = late ? "late" : onTime ? "on_time" : null;
      setResultStatus(confirmedStatus);
      const arrived = data.arrived_at
        ? new Date(data.arrived_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Porto-Novo" })
        : data.requested_at
          ? new Date(data.requested_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Porto-Novo" })
          : "";
      if (isPersonnel) {
        const penalty = Number(data.penalty_amount_fcfa || 0);
        const attendanceText = data.duplicate
          ? "POINTAGE DÉJÀ ENREGISTRÉ — "
          : late ? "EN RETARD — " : "PRÉSENCE DU PERSONNEL CONFIRMÉE — ";
        setMessage(attendanceText + "Votre présence du personnel est enregistrée" + (arrived ? " à " + arrived : "") + "." +
          (late ? " Retard calculé : " + (delay ?? "non précisé") + " minute(s)." : onTime ? " Vous êtes arrivé à l’heure." : " Statut horaire non confirmé par le serveur ; aucune confirmation « à l’heure » n’est affichée.") +
          (penalty > 0 ? " Pénalité automatique : " + penalty.toLocaleString("fr-FR") + " FCFA." : "") +
          " Ce résultat concerne votre présence professionnelle, pas un accès à un cours.");
      } else if (data.already_confirmed) {
        setMessage("PRÉSENCE DÉJÀ CONFIRMÉE — Votre pointage initial" + (arrived ? " de " + arrived : "") +
          " est déjà enregistré. " + (late ? "Le statut initial reste : retard de " + (delay ?? "non précisé") + " minute(s)." : onTime ? "Le statut initial est : à l’heure." : "Le statut horaire initial doit être vérifié au secrétariat.") +
          (data.access_blocked ? " Votre accès reste soumis à la situation de régularisation enregistrée auprès du secrétariat." : " Aucun nouveau pointage n’a été créé. Ce scan n’a rien modifié."));
      } else if (data.duplicate) {
        setMessage("DEMANDE DÉJÀ ENVOYÉE — Votre demande initiale" + (arrived ? " de " + arrived : "") +
          " est toujours en attente de confirmation physique par le secrétariat. Aucun nouveau pointage ni nouveau retard n’a été créé.");
      } else {
        setMessage(late
          ? "RETARD SIGNALÉ — " + (delay ?? "non précisé") + " minute(s). Votre demande a été envoyée et reste en attente de confirmation physique par le secrétariat. Le scan seul ne donne pas accès au cours."
          : onTime
            ? "DEMANDE ENVOYÉE — À L’HEURE. Présentez-vous au secrétariat pour la confirmation physique obligatoire avant l’accès au cours."
            : "DEMANDE ENVOYÉE — STATUT HORAIRE À VÉRIFIER. Le serveur n’a pas fourni les éléments nécessaires pour confirmer « à l’heure ». Présentez-vous au secrétariat.");
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
      <p role={state === "done" ? "status" : undefined} style={{ color: resultStatus === "on_time" ? "#166534" : resultStatus === "late" ? "#991b1b" : "#53647a", background: resultStatus === "on_time" ? "#dcfce7" : resultStatus === "late" ? "#fee2e2" : "transparent", border: resultStatus ? `1px solid ${resultStatus === "on_time" ? "#86efac" : "#fca5a5"}` : "1px solid transparent", borderRadius: 12, padding: resultStatus ? 16 : 0, fontWeight: resultStatus ? 700 : 400, lineHeight: 1.6 }}>{message}</p>
      <video ref={videoRef} playsInline muted style={{ display: state === "scanning" ? "block" : "none", width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 12, background: "#101828", margin: "16px 0" }} />
      {state === "ready" || state === "error" ? <button onClick={() => void startScan()} disabled={busy} style={{ width: "100%", padding: 14, border: 0, borderRadius: 10, background: "#1769d2", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 12 }}>Ouvrir la caméra et scanner</button> : null}
      {state === "done" ? <button onClick={() => { setState("ready"); setResultStatus(null); setMessage("Vous pouvez terminer ou scanner le QR officiel pour une nouvelle séance ou journée de service."); }} style={{ width: "100%", padding: 14, border: 0, borderRadius: 10, background: "#1769d2", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 12 }}>Terminé</button> : null}
      <p style={{ marginTop: 20 }}><Link href="/" style={{ color: "#1769d2", fontWeight: 700, textDecoration: "none" }}>← Retour à mon espace</Link></p>
    </section>
  </main>;
}
