import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const reviewers=new Set(["SECRETARY","SECRETARIAT","SECRETAIRE","SECRÉTAIRE","DIRECTOR","ADMIN","PRE_ADMIN"]);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply(405,{error:"METHOD_NOT_ALLOWED"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const apiKey=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("AERO_SERVICE_FROM_EMAIL"),appUrl=Deno.env.get("AERO_SERVICE_APP_URL")??"https://aero-service.vercel.app/";
 if(!url||!anon||!service)return reply(503,{error:"SERVICE_UNAVAILABLE"});
 const authHeader=req.headers.get("Authorization")??"";if(!authHeader.startsWith("Bearer "))return reply(401,{error:"AUTH_REQUIRED"});
 const token=authHeader.slice(7),caller=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:callerData,error:callerError}=await caller.auth.getUser(token);if(callerError||!callerData.user)return reply(401,{error:"INVALID_SESSION"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:roles,error:rolesError}=await admin.from("user_roles").select("roles(code)").eq("user_id",callerData.user.id);
 if(rolesError)return reply(503,{error:"ROLE_LOOKUP_FAILED"});
 const codes=(roles??[]).flatMap((x:any)=>Array.isArray(x.roles)?x.roles:x.roles?[x.roles]:[]).map((x:any)=>String(x.code??"").toUpperCase());
 if(!codes.some((code:string)=>reviewers.has(code)))return reply(403,{error:"SECRETARIAT_ROLE_REQUIRED"});
 let body:{person_id?:unknown};try{body=await req.json();}catch{return reply(400,{error:"INVALID_REQUEST"});}
 const personId=typeof body.person_id==="string"?body.person_id:"";
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(personId))return reply(400,{error:"INVALID_USER"});
 const {data:reg,error:regError}=await admin.from("registrations").select("status,registration_number").eq("person_id",personId).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(regError)return reply(503,{error:"REGISTRATION_LOOKUP_FAILED",detail:regError.message});
 if(!reg||reg.status!=="approved")return reply(409,{error:"REGISTRATION_NOT_APPROVED",detail:"Validez d’abord l’inscription. Le statut du compte n’a pas été modifié."});
 const {data:profile,error:profileError}=await admin.from("profiles").select("email,display_name,first_name,last_name,status").eq("id",personId).maybeSingle();
 if(profileError||!profile||profile.status!=="active")return reply(409,{error:"ACCOUNT_NOT_ACTIVE",detail:"Le compte doit être actif avant l’envoi du message."});
 if(!profile.email)return reply(400,{error:"EMAIL_MISSING",detail:"Aucune adresse e-mail n’est enregistrée pour ce compte."});
 if(!apiKey||!from)return reply(503,{error:"MAILER_NOT_CONFIGURED",detail:"Le compte reste actif. Pour envoyer automatiquement les e-mails, configurez RESEND_API_KEY et AERO_SERVICE_FROM_EMAIL dans les secrets de la fonction."});
 const name=profile.display_name||[profile.first_name,profile.last_name].filter(Boolean).join(" ")||"apprenant";
 const html=`<div style="font-family:Arial,sans-serif;color:#172b43;line-height:1.6"><h2>Bienvenue à Aéro Service, ${name.replace(/[&<>"]/g,(c:string)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!))} !</h2><p>Votre inscription est validée et votre compte apprenant est actif.</p><p>Vous pouvez accéder à votre espace personnel à l’aide de votre adresse e-mail et du mot de passe choisi lors de la création du compte.</p><p><a href="${appUrl}" style="display:inline-block;padding:12px 18px;background:#1769d2;color:#fff;text-decoration:none;border-radius:6px">Accéder à la plateforme Aéro Service</a></p><p>Ce lien vous dirige vers la plateforme. Il ne modifie ni votre mot de passe ni le statut actif de votre compte.</p><p>L’équipe Aéro Service</p></div>`;
 const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[profile.email],subject:"Bienvenue à Aéro Service — votre compte est actif",html})});
 if(!response.ok){const detail=await response.text();return reply(502,{error:"WELCOME_EMAIL_FAILED",detail:detail.slice(0,500)});}
 return reply(200,{ok:true,email:profile.email,account_active:true,registration_number:reg.registration_number});
});