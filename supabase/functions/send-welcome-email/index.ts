import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return new Response(JSON.stringify({error:"METHOD_NOT_ALLOWED"}),{status:405,headers:cors});
 return new Response(JSON.stringify({error:"MAILER_NOT_CONFIGURED",detail:"Le compte apprenant reste actif. L’envoi automatique du message de bienvenue nécessite la configuration d’un expéditeur e-mail pour Aéro Service."}),{status:503,headers:cors});
});