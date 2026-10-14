"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export default function PointagePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get("token");
    if (queryToken) setToken(queryToken);
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) setEmail(data.session.user.email);
    });
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const enteredEmail = email.trim();
    const { data: sessionData } = await supabase.auth.getSession();
    const currentEmail = sessionData.session?.user?.email?.trim().toLowerCase();
    const requestedEmail = enteredEmail.toLowerCase();

    // Never reuse a different signed-in user's session for this check-in.
    if (sessionData.session && currentEmail !== requestedEmail) {
      await supabase.auth.signOut();
    }

    const { data: freshSessionData } = await supabase.auth.getSession();
    if (!freshSessionData.session) {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email: enteredEmail, password });
      if (loginError) {
        setError("Connexion impossible : vérifiez vos identifiants. " + loginError.message);
        setBusy(false);
        return;
      }
    }
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracy: number | null = null;
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 })
        );
        lat = position.coords.latitude;
        lng = position.coords.longitude;
        accuracy = position.coords.accuracy;
      } catch {
        // The server accepts a check-in without GPS only when its configured rules allow it.
      }
    }
    const { data, error: checkinError } = await supabase.rpc("kiosk_daily_checkin", {
      p_device_token: token.trim(),
      p_lat: lat,
      p_lng: lng,
      p_accuracy_m: accuracy
    });
    if (checkinError) {
      setError("Pointage non confirmé. " + checkinError.message);
    } else {
      setMessage("Pointage transmis au serveur. " + (data?.status ? "Statut : " + data.status + "." : "Vérifiez le statut retourné avant de quitter."));
      setPassword("");
    }
    setBusy(false);
  }

  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:20,background:"#f2f6fb",fontFamily:"Arial,sans-serif",color:"#162b45"}}>
    <section style={{width:"100%",maxWidth:480,background:"#fff",padding:28,borderRadius:18,boxShadow:"0 12px 40px rgba(25,50,80,.10)"}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <img src="/logo-aero-services.jpg" alt="Logo Aéro Service" style={{width:110,height:70,objectFit:"contain"}}/>
        <h1 style={{fontSize:25,margin:"10px 0 6px"}}>Pointage Aéro Service</h1>
        <p style={{color:"#63758b",fontSize:14,margin:0}}>Connectez-vous avec votre compte apprenant et utilisez le QR de la borne.</p>
      </div>
      {error && <div role="alert" style={{padding:12,marginBottom:16,borderRadius:8,background:"#fff0f0",color:"#a32626",fontSize:14}}>{error}</div>}
      {message && <div role="status" style={{padding:12,marginBottom:16,borderRadius:8,background:"#edf8f0",color:"#176b37",fontSize:14}}>{message}</div>}
      <form onSubmit={submit} style={{display:"grid",gap:14}}>
        <label style={{display:"grid",gap:6,fontSize:13,fontWeight:600}}>Adresse e-mail
          <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" style={{padding:12,border:"1px solid #d7e0ea",borderRadius:8,fontSize:15}}/>
        </label>
        <label style={{display:"grid",gap:6,fontSize:13,fontWeight:600}}>Mot de passe
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required style={{padding:12,border:"1px solid #d7e0ea",borderRadius:8,fontSize:15}}/>
        </label>
        <label style={{display:"grid",gap:6,fontSize:13,fontWeight:600}}>Jeton sécurisé de la borne
          <input value={token} onChange={e=>setToken(e.target.value)} required autoComplete="off" placeholder="Jeton transmis par le QR de la borne" style={{padding:12,border:"1px solid #d7e0ea",borderRadius:8,fontSize:15}}/>
        </label>
        <button type="submit" disabled={busy} style={{padding:14,border:0,borderRadius:9,background:"#1769d2",color:"#fff",fontSize:15,fontWeight:700,cursor:busy?"wait":"pointer"}}>{busy?"Vérification du pointage…":"Enregistrer mon pointage"}</button>
      </form>
      <p style={{fontSize:12,color:"#75869a",lineHeight:1.6,marginTop:18}}>Le pointage n’est enregistré qu’après confirmation du serveur. Ne partagez pas le jeton de la borne. Si la géolocalisation est demandée, autorisez-la sur votre appareil.</p>
    </section>
  </main>;
}
