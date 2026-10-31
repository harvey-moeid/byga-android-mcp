import assets from '../../work/dashboard-assets.json';
import OAuthProvider, { type OAuthHelpers, getOAuthApi, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import { z, ZodError } from 'zod';
import { ApiError, boundBody, equal, escapeHtml, hash, randomToken, readJson } from '../../packages/auth';
import { id, jobInput, scopes, tools, type Actor, type Device } from '../../packages/protocol';
import { read, list, authenticateDevice, device, findJob, listDevices, registry, session, submit } from './service';
import { mcp } from './mcp';
import { workflowSchema } from '../sessions/workflow';
import { validateTool } from '../../packages/protocol';
export { DeviceRegistryDO } from '../sessions/registry';
export { DeviceSessionDO } from '../sessions/device';

const owner: Actor = {tenant_id:'owner',actor_id:'owner',client_id:'dashboard',scopes:[...scopes],admin:true};
type Session = { expires:number };
const cookieName='__Host-byga';
async function admin(request: Request, env: Env) {
  const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const s=token?await read<Session>(registry(env),'session:'+await hash(token)):null;
  if(!s || s.expires<Date.now())throw new ApiError('UNAUTHORIZED',401);
}
function sameOrigin(request:Request,env:Env) { if(request.headers.get('Origin')!==env.PUBLIC_ORIGIN) throw new ApiError('ORIGIN_DENIED',403); }
function json(data:unknown,status=200) {return Response.json(data,{status});}
async function body<T extends z.ZodType>(request:Request,schema:T):Promise<z.infer<T>>{return schema.parse(await readJson(request));}
async function oauthConsent(request:Request,env:Env,api:OAuthHelpers) {
  const u=new URL(request.url);
  try {await admin(request,env);}catch{return Response.redirect(env.PUBLIC_ORIGIN+'/dashboard?return_to='+encodeURIComponent(u.pathname+u.search),302);}
  if(request.method==='GET') {
    const auth=await api.parseAuthRequest(request);
    if(auth.codeChallengeMethod!=='S256' || !auth.codeChallenge) throw new ApiError('PKCE_S256_REQUIRED');
    if(auth.scope.some(s=>!scopes.includes(s as typeof scopes[number])))throw new ApiError('INVALID_SCOPE');
    const description=await api.describeConsent(auth);const consent=await api.beginConsent(auth);
    const html=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Persetujuan BYGA</title><body style="font:18px system-ui;max-width:650px;margin:10vh auto;padding:24px;background:#111827;color:white"><h1>Izinkan akses MCP?</h1><p>Client: ${escapeHtml(JSON.stringify(description))}</p><p>Scopes: ${escapeHtml(auth.scope.join(', '))}</p><p>Tool berisiko tetap memerlukan approval terpisah. Jangan setujui client yang tidak Anda kenal.</p><form method="post"><input type="hidden" name="handle" value="${escapeHtml(consent.handle)}"><button name="decision" value="allow">Izinkan</button> <button name="decision" value="deny">Tolak</button></form></body></html>`;
    consent.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:consent.headers});
  }
  sameOrigin(request,env);
  if(Number(request.headers.get('Content-Length'))>8192)throw new ApiError('PAYLOAD_TOO_LARGE',413);
  const form=await request.formData();const handle=String(form.get('handle')??'');
  if(form.get('decision')!=='allow'){const denied=await api.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers});}
  const approved=await api.approveConsent(request,handle);
  const result=await api.completeAuthorization({request:approved.request,userId:'owner',scope:approved.request.scope,metadata:{client:approved.request.clientId},props:{...owner,admin:false,client_id:approved.request.clientId,scopes:approved.request.scope}});
  await registry(env).record('oauth_grant',approved.request.clientId);
  approved.headers.set('Location',result.redirectTo);return new Response(null,{status:302,headers:approved.headers});
}
async function routes(request:Request,env:Env,api:OAuthHelpers):Promise<Response> {
  const u=new URL(request.url);const p=u.pathname;const method=request.method;const reg=registry(env);
  if(p==='/api/health' && method==='GET')return json({status:'ok',service:'byga-android-mcp',version:'1.0.0',mode:'production'});
  if(p==='/oauth/authorize')return oauthConsent(request,env,api);
  if(p==='/api/auth/login' && method==='POST') {
    sameOrigin(request,env);
    const ip=request.headers.get('CF-Connecting-IP')??'local';
    if(!await reg.rate('login:'+ip,10,600000)||!await reg.rate('login-global',100,600000))throw new ApiError('RATE_LIMITED',429);
    const {password}=await body(request,z.object({password:z.string().min(1).max(256)}).strict());
    if(!equal(await hash(password),env.ADMIN_PASSWORD_HASH))throw new ApiError('INVALID_CREDENTIALS',401);
    const token=randomToken();const expires=Date.now()+8*3600000;await reg.put('session:'+await hash(token),{expires},expires);await reg.record('admin_login','owner');
    return Response.json({ok:true},{headers:{'Set-Cookie':`${cookieName}=${token}; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800`}});
  }
  if(p==='/api/pair/claim' && method==='POST') {
    if(!await reg.rate('claim:'+ (request.headers.get('CF-Connecting-IP')??'local'),10))throw new ApiError('RATE_LIMITED',429);
    const input=await body(request,z.object({code:z.string().regex(/^[a-f0-9]{32}$/),name:z.string().min(1).max(60),platform:z.string().max(60),capabilities:z.array(z.enum(Object.keys(tools) as [keyof typeof tools,...(keyof typeof tools)[]])).max(20)}).strict());
    const pairing=await reg.take('pair:'+await hash(input.code));if(!pairing)throw new ApiError('PAIRING_EXPIRED',403);
    const token=randomToken();const deviceId=crypto.randomUUID();
    const d:Device={device_id:deviceId,name:input.name,platform:input.platform,capabilities:input.capabilities,confirmed:false,revoked:false,stopped:false,created_at:Date.now(),credential_hash:await hash(token)};
    await reg.put('device:'+deviceId,d);await reg.record('pair_claimed',deviceId);
    return json({device_id:deviceId,token,status:'waiting_owner_confirmation'},201);
  }
  if(p==='/api/device/connect') {const d=await authenticateDevice(request,env);return session(env,d.device_id).fetch(request);}
  if(!p.startsWith('/api/')){if(method!=='GET'&&method!=='HEAD')throw new ApiError('METHOD_NOT_ALLOWED',405);const manifest:Record<string,{body:string;contentType:string}>=assets;const asset=manifest[p]??((p==='/'||p==='/dashboard')?manifest['/index.html']:null);if(!asset)throw new ApiError('NOT_FOUND',404);return new Response(method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.contentType}});}
  await admin(request,env);
  if(!await reg.rate('admin',300))throw new ApiError('RATE_LIMITED',429);
  if(!['GET','HEAD'].includes(method))sameOrigin(request,env);
  if(p==='/api/auth/session' && method==='GET')return json({user:'owner',scopes,mode:'production'});
  if(p==='/api/auth/logout' && method==='POST') {const t=request.headers.get('Cookie')?.match(/__Host-byga=([^;]+)/)?.[1];if(t)await reg.remove('session:'+await hash(t));return Response.json({ok:true},{headers:{'Set-Cookie':`${cookieName}=; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`}});}
  if(p==='/api/devices' && method==='GET')return json(await listDevices(env));
  if(p==='/api/pair' && method==='POST') {if((await list<Device>(reg,'device:')).length>=50)throw new ApiError('DEVICE_LIMIT',409);const code=randomToken().slice(0,32);await reg.put('pair:'+await hash(code),{created:Date.now()},Date.now()+300000);await reg.record('pair_created','owner');return json({code,expires_at:Date.now()+300000},201);}
  const dm=p.match(/^\/api\/devices\/([^/]+)(?:\/(confirm|revoke|stop|resume|status))?$/);
  if(dm) {
    const deviceId=id.parse(dm[1]);const d=await device(env,deviceId);
    if(method==='GET') {const {credential_hash:_hash,...safe}=d;return json({...safe,...await session(env,deviceId).status()});}
    if(method==='POST' && dm[2]) {
      if(dm[2]==='confirm')await reg.updateDevice(deviceId,{confirmed:true});
      else if(dm[2]==='revoke'){await reg.updateDevice(deviceId,{revoked:true});await session(env,deviceId).stop();}
      else if(dm[2]==='stop'){await reg.updateDevice(deviceId,{stopped:true});await session(env,deviceId).stop();}
      else if(dm[2]==='resume')await reg.updateDevice(deviceId,{stopped:false});else throw new ApiError('METHOD_NOT_ALLOWED',405);
      await reg.record('device_'+dm[2],deviceId);return json({ok:true});
    }
  }
  if(p==='/api/jobs' && method==='POST')return json(await submit(env,owner,await body(request,jobInput)),201);
  if((p==='/api/jobs'||p==='/api/approvals')&&method==='GET') {
    const ds=await list<Device>(reg,'device:');const jobs=(await Promise.all(ds.map(d=>session(env,d.device_id).jobs()))).flat().sort((a,b)=>b.created_at-a.created_at).slice(0,200);
    return json(p==='/api/approvals'?jobs.filter(j=>j.status==='waiting_approval'):jobs);
  }
  const jm=p.match(/^\/api\/jobs\/([^/]+)(?:\/(cancel|approve|deny))?$/);
  if(jm) {const j=await findJob(env,id.parse(jm[1]));if(method==='GET')return json(j);if(method==='POST'){const s=session(env,j.device_id);const result=jm[2]==='cancel'?await s.cancel(j.job_id):jm[2]==='approve'||jm[2]==='deny'?await s.approve(j.job_id,jm[2]==='approve'):null;await reg.record('job_'+jm[2],j.job_id);return json(result);}}
  if(p==='/api/workflows'&&method==='GET')return json(await list(reg,'workflow:'));
  if(p==='/api/workflows'&&method==='POST'){const value=await body(request,workflowSchema);await device(env,value.device_id);for(const step of value.steps)validateTool(step.tool,step.arguments);const w={...value,id:crypto.randomUUID()};await reg.put('workflow:'+w.id,w);await reg.record('workflow_created',w.id);return json(w,201);}
  const wm=p.match(/^\/api\/workflows\/([^/]+)\/run$/);if(wm&&method==='POST')return json(JSON.parse(await reg.startRun(id.parse(wm[1]),owner)),201);
  if(p==='/api/workflow-runs'&&method==='GET')return json(await list(reg,'run:'));
  const wr=p.match(/^\/api\/workflow-runs\/([^/]+)\/cancel$/);if(wr&&method==='POST')return json(JSON.parse(await reg.cancelRun(id.parse(wr[1]),owner)));
  if(p==='/api/audit'&&method==='GET')return json(await reg.audit());
  if(p==='/api/permissions'&&method==='GET')return json({scopes,tools:Object.fromEntries(Object.entries(tools).map(([name,s])=>[name,{scope:s.scope,approval:s.approval}])),emergency_stop:!!await read<boolean>(reg,'emergency_stop'),advanced_shell:false});
  if(p==='/api/emergency-stop'&&method==='POST') {const {enabled}=await body(request,z.object({enabled:z.boolean()}).strict());await reg.put('emergency_stop',enabled);if(enabled)for(const d of await list<Device>(reg,'device:'))await session(env,d.device_id).stop();await reg.record('emergency_stop',String(enabled));return json({enabled});}
  if(p==='/api/clients'&&method==='GET')return json({clients:await list(reg,'client:'),grants:await api.listUserGrants('owner')});
  if(p==='/api/clients'&&method==='POST') {const input=await body(request,z.object({name:z.string().min(1).max(80),scopes:z.array(z.enum(scopes)).min(1).max(7)}).strict());const token='byga_'+randomToken();const key=await hash(token);const client_id=crypto.randomUUID();const props={...owner,admin:false,client_id,scopes:input.scopes};await reg.put('pat:'+key,props,Date.now()+30*86400000);await reg.put('client:'+client_id,{...input,client_id,key,expires_at:Date.now()+30*86400000});await reg.record('client_created',client_id);return json({token,client_id},201);}
  const cm=p.match(/^\/api\/clients\/([^/]+)\/revoke$/);
  if(cm&&method==='POST'){const client=await read<{key:string}>(reg,'client:'+id.parse(cm[1]));if(client)await reg.remove('pat:'+client.key);await reg.remove('client:'+cm[1]);await reg.record('client_revoked',cm[1]);return json({ok:true});}
  const gm=p.match(/^\/api\/grants\/([^/]+)\/revoke$/);if(gm&&method==='POST'){await api.revokeGrant(gm[1],'owner');await reg.record('grant_revoked',gm[1]);return json({ok:true});}
  throw new ApiError('NOT_FOUND',404);
}
function provider(env:Env) {
  const options:OAuthProviderOptions<Env> = {apiRoute:'/mcp',apiHandler:{async fetch(request,e,ctx){const actor=ctx.props as Actor;if(!actor || actor.tenant_id!=='owner' || !Array.isArray(actor.scopes))throw new ApiError('PERMISSION_DENIED',403);if(!await registry(e).rate('mcp:'+actor.client_id,120))throw new ApiError('RATE_LIMITED',429);return mcp(request,e,ctx,actor);}},defaultHandler:{fetch:(r,e)=>routes(r,e,getOAuthApi(options,e))},authorizeEndpoint:'/oauth/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',scopesSupported:[...scopes],requiredScopes:['device:read'],accessTokenTTL:900,refreshTokenTTL:86400,resourceMetadata:{resource:env.PUBLIC_ORIGIN+'/mcp',authorization_servers:[env.PUBLIC_ORIGIN]},resolveExternalToken:async({token,env:e})=>{const actor=await read<Actor>(registry(e),'pat:'+await hash(token));return actor?{props:actor,audience:e.PUBLIC_ORIGIN+'/mcp'}:null;}};
  return new OAuthProvider<Env>(options);
}
export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    try {
      const url=new URL(request.url);
      if(url.origin!==env.PUBLIC_ORIGIN)throw new ApiError('HOST_DENIED',403);
      const origin=request.headers.get('Origin');if(origin && origin!==env.PUBLIC_ORIGIN)throw new ApiError('ORIGIN_DENIED',403);
      if(Number(request.headers.get('Content-Length'))>65536)throw new ApiError('PAYLOAD_TOO_LARGE',413);
      request=await boundBody(request);
      if(url.pathname==='/oauth/register'||url.pathname==='/oauth/token'){
        const key=url.pathname+':'+(request.headers.get('CF-Connecting-IP')??'local');
        if(!await registry(env).rate(key,30)||!await registry(env).rate('oauth-global',300))throw new ApiError('RATE_LIMITED',429);
      }
      const response=await provider(env).fetch(request,env,ctx);
      if(response.status===101)return response;
      const headers=new Headers(response.headers);
      headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','no-referrer');headers.set('Cache-Control','no-store');headers.set('Strict-Transport-Security','max-age=31536000');
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      return new Response(response.body,{status:response.status,headers});
    } catch(e) { const code=e instanceof ZodError?'INVALID_ARGUMENT':e instanceof ApiError?e.code:'INTERNAL_ERROR';if(code==='INTERNAL_ERROR')console.error(JSON.stringify({event:'request_failed',name:e instanceof Error?e.name:'unknown'}));return json({error:{code,request_id:crypto.randomUUID()}},e instanceof ApiError?e.status:e instanceof ZodError?400:500); }
  }
} satisfies ExportedHandler<Env>;
