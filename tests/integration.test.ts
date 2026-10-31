import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {chromium} from '@playwright/test';
const origin='http://127.0.0.1:8788';
let mf:Miniflare,cookie='',deviceId='',agent:ChildProcess|undefined,temp='',token='';
async function req(path:string,method='GET',data?:unknown,authorized=true,headers:Record<string,string>={}){
 return fetch(origin+path,{method,headers:{Origin:origin,...(authorized?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});
}
async function data(path:string,method='GET',body?:unknown){const r=await req(path,method,body);const d=await r.json();expect(r.status,JSON.stringify(d)).toBeLessThan(400);return d;}
async function waitFor(fn:()=>Promise<boolean>,ms=10000){const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Condition timeout');}
async function mcp(method:string,params:unknown,auth=token){const r=await req('/mcp','POST',{jsonrpc:'2.0',id:1,method,params},false,{Authorization:'Bearer '+auth,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'});const text=await r.text();let value;try{value=JSON.parse(text);}catch{const line=text.split('\n').find(s=>s.startsWith('data: '));value=line?JSON.parse(line.slice(6)):text;}return {r,value};}
beforeAll(async()=>{
 temp=await mkdtemp(join(tmpdir(),'byga-integration-'));await mkdir(join(temp,'workspace'));
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/index.js',compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],host:'127.0.0.1',port:8788,bindings:{PUBLIC_ORIGIN:origin,ADMIN_PASSWORD_HASH:createHash('sha256').update('integration-owner-secret').digest('hex')},durableObjects:{REGISTRY:{className:'DeviceRegistryDO',useSQLite:true},SESSIONS:{className:'DeviceSessionDO',useSQLite:true}},kvNamespaces:['OAUTH_KV']}));await mf.ready;
 const login=await req('/api/auth/login','POST',{password:'integration-owner-secret'},false);expect(login.status).toBe(200);cookie=login.headers.get('set-cookie')!.split(';')[0];
},30000);
afterAll(async()=>{agent?.kill('SIGTERM');await mf?.dispose();});
describe('Worker / DO / MCP / real Go agent',()=>{
 it('protects APIs, host, origin and oversized inputs',async()=>{
  expect((await req('/api/devices','GET',undefined,false)).status).toBe(401);
  expect((await req('/api/health','GET',undefined,false,{Origin:'https://evil.example'})).status).toBe(403);
  expect((await req('/api/jobs','POST',{blob:'a'.repeat(70000)})).status).toBe(413);
  const r=await req('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/list'},false,{Accept:'application/json, text/event-stream'});expect(r.status).toBe(401);expect(r.headers.get('www-authenticate')).toContain('resource_metadata');
 });
 it('pairs once and requires owner confirmation',async()=>{
  const pair=await data('/api/pair','POST',{});const body={code:pair.code,name:'Integration Go device',platform:'Linux simulator',capabilities:['terminal_run','files_list','files_read','files_write','files_delete']};
  const r=await req('/api/pair/claim','POST',body,false);expect(r.status).toBe(201);const d=await r.json();deviceId=d.device_id;
  expect((await req('/api/pair/claim','POST',body,false)).status).toBe(403);
  expect((await req('/api/device/connect','GET',undefined,false,{'X-Device-Id':deviceId,Authorization:'Bearer '+d.token})).status).toBe(403);
  await data(`/api/devices/${deviceId}/confirm`,'POST',{});
  await writeFile(join(temp,'agent.json'),JSON.stringify({server:origin,device_id:deviceId,token:d.token,workspace:join(temp,'workspace'),allow_write:true}),{mode:0o600});
 });
 it('queues offline work, executes through real Go WSS and deduplicates',async()=>{
  const input={device_id:deviceId,tool:'terminal_run',arguments:{command:'date',args:[]},reason:'Integration date check',idempotency_key:'integration-date-001'};
  const job=await data('/api/jobs','POST',input);expect(job.status).toBe('waiting_device');const duplicates=await Promise.all(Array.from({length:12},()=>data('/api/jobs','POST',input)));expect(new Set(duplicates.map(j=>j.job_id))).toEqual(new Set([job.job_id]));
  agent=spawn('./dist/byga-agent-linux-amd64',['start'],{env:{...process.env,BYGA_CONFIG:join(temp,'agent.json'),NO_PROXY:'127.0.0.1,localhost'},stdio:'ignore'});
  await waitFor(async()=>{const j=await data('/api/jobs/'+job.job_id);return j.status==='completed';});
  const result=await data('/api/jobs/'+job.job_id);expect(result.result.stdout.length).toBeGreaterThan(5);expect(result.attempt).toBe(1);
 });
 it('holds writes for owner approval and reads actual bytes',async()=>{
  const input={device_id:deviceId,tool:'files_write',arguments:{path:'hello.txt',content:'BYGA integration verified'},reason:'Owner approved test file',idempotency_key:'integration-write-001'};
  const job=await data('/api/jobs','POST',input);expect(job.status).toBe('waiting_approval');expect((await data('/api/approvals')).some((j:{job_id:string})=>j.job_id===job.job_id)).toBe(true);await data('/api/jobs/'+job.job_id+'/approve','POST',{});await waitFor(async()=> (await data('/api/jobs/'+job.job_id)).status==='completed');expect(await readFile(join(temp,'workspace','hello.txt'),'utf8')).toBe('BYGA integration verified');
 });
 it('enforces MCP client scopes, initialize, discovery, execution and revocation',async()=>{
  const client=await data('/api/clients','POST',{name:'MCP test',scopes:['device:read','terminal:run']});token=client.token;
  const init=await mcp('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'BYGA integration',version:'1'}});expect(init.r.status).toBe(200);expect(init.value.result.serverInfo.name).toBe('byga-android-mcp');
  const listed=await mcp('tools/list',{});expect(listed.value.result.tools.some((t:{name:string})=>t.name==='terminal_run')).toBe(true);expect(listed.value.result.tools.some((t:{name:string})=>t.name==='files_write')).toBe(false);
  const called=await mcp('tools/call',{name:'terminal_run',arguments:{device_id:deviceId,arguments:{command:'uname',args:['-a']},reason:'MCP integration check',idempotency_key:'mcp-uname-0001'}});expect(called.r.status).toBe(200);expect(called.value.result.structuredContent.data.job_id).toBeTruthy();
  const denied=await mcp('tools/call',{name:'files_write',arguments:{}});expect(denied.value.error||denied.value.result?.isError).toBeTruthy();
  await data(`/api/clients/${client.client_id}/revoke`,'POST',{});expect((await mcp('tools/list',{})).r.status).toBe(401);
 });
 it('performs OAuth PKCE consent, validates verifier, and revokes grants',async()=>{
  const registration=await req('/oauth/register','POST',{client_name:'OAuth integration',redirect_uris:['http://127.0.0.1:9999/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},false);expect(registration.status).toBe(201);const client=await registration.json();
  const verifier='byga-test-pkce-verifier-abcdefghijklmnopqrstuvwxyz0123456789';const challenge=createHash('sha256').update(verifier).digest('base64url');
  const params=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:'http://127.0.0.1:9999/callback',scope:'device:read terminal:run',state:'test-state',code_challenge:challenge,code_challenge_method:'S256',resource:origin+'/mcp'});
  const consent=await req('/oauth/authorize?'+params);expect(consent.status).toBe(200);const page=await consent.text();const handle=page.match(/name="handle" value="([^"]+)"/)?.[1];expect(handle).toBeTruthy();const cookies=consent.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const approved=await fetch(origin+'/oauth/authorize',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie+'; '+cookies,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle:handle!,decision:'allow'})});expect(approved.status).toBe(302);const redirect=new URL(approved.headers.get('Location')!);expect(redirect.searchParams.get('state')).toBe('test-state');const code=redirect.searchParams.get('code')!;
  const exchange=async(v:string)=>fetch(origin+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:'http://127.0.0.1:9999/callback',code_verifier:v,resource:origin+'/mcp'})});
  expect((await exchange('wrong-verifier')).status).toBe(400);
  // A failed verifier may consume the code defensively; use a fresh approval below when needed.
  const second=await req('/oauth/authorize?'+params);const secondPage=await second.text();const secondHandle=secondPage.match(/name="handle" value="([^"]+)"/)![1];const secondCookies=second.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const granted=await fetch(origin+'/oauth/authorize',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie+'; '+secondCookies,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle:secondHandle,decision:'allow'})});expect(granted.status).toBe(302);const freshCode=new URL(granted.headers.get('Location')!).searchParams.get('code')!;
  const exchanged=await fetch(origin+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code:freshCode,redirect_uri:'http://127.0.0.1:9999/callback',code_verifier:verifier,resource:origin+'/mcp'})});const tokens=await exchanged.json();expect(exchanged.status,JSON.stringify(tokens)).toBe(200);expect((await mcp('tools/list',{},tokens.access_token)).r.status).toBe(200);
  const grants=await data('/api/clients');const grant=grants.grants.items.find((g:{clientId:string})=>g.clientId===client.client_id);expect(grant).toBeTruthy();await data('/api/grants/'+grant.id+'/revoke','POST',{});expect((await mcp('tools/list',{},tokens.access_token)).r.status).toBe(401);
 });
 it('rejects injection, traversal, unadvertised capabilities and device forgery',async()=>{
  for(const args of [{command:'sh',args:['-c','id']},{command:'date',args:[';id']}])expect((await req('/api/jobs','POST',{device_id:deviceId,tool:'terminal_run',arguments:args,reason:'Rejected operation test',idempotency_key:crypto.randomUUID()})).status).toBeGreaterThanOrEqual(400);
  expect((await req('/api/jobs','POST',{device_id:deviceId,tool:'files_read',arguments:{path:'../secret'},reason:'Reject traversal test',idempotency_key:crypto.randomUUID()})).status).toBe(400);
  expect((await req('/api/jobs','POST',{device_id:deviceId,tool:'android_tap',arguments:{x:2,y:2},reason:'Unsupported test',idempotency_key:crypto.randomUUID()})).status).toBe(409);
  expect((await req('/api/device/connect','GET',undefined,false,{'X-Device-Id':deviceId,Authorization:'Bearer forged'})).status).toBe(403);
 });
 it('runs a persisted workflow sequentially',async()=>{
  const w=await data('/api/workflows','POST',{name:'Integration workflow',device_id:deviceId,steps:[{tool:'terminal_run',arguments:{command:'date',args:[]},reason:'First step'},{tool:'terminal_run',arguments:{command:'uname',args:[]},reason:'Second step'}]});const run=await data(`/api/workflows/${w.id}/run`,'POST',{});await waitFor(async()=> (await data('/api/workflow-runs')).some((r:{id:string;status:string})=>r.id===run.id&&r.status==='completed'),15000);
 });
 it('cancels a workflow before dispatch',async()=>{
  const w=await data('/api/workflows','POST',{name:'Cancellation workflow',device_id:deviceId,steps:[{tool:'terminal_run',arguments:{command:'date',args:[]},reason:'Cancelled before execution'}]});const run=await data(`/api/workflows/${w.id}/run`,'POST',{});await data(`/api/workflow-runs/${run.id}/cancel`,'POST',{});await new Promise(r=>setTimeout(r,1200));expect((await data('/api/workflow-runs')).find((r:{id:string})=>r.id===run.id).status).toBe('cancelled');
 });
 it('renders the real dashboard on desktop and mobile with working pairing',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
  try{const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/dashboard');await page.getByLabel('Kunci akses pemilik').fill('integration-owner-secret');await page.getByRole('button',{name:'Masuk ke control center'}).click();await page.getByRole('heading',{name:'Semua perangkat. Satu kendali.'}).waitFor();await page.getByRole('button',{name:'Tambah perangkat'}).click();await page.getByRole('dialog',{name:'Hubungkan perangkat'}).waitFor();await page.keyboard.press('Escape');await mkdir('work/screenshots',{recursive:true});await page.screenshot({path:'work/screenshots/dashboard-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.sidebar')!.getBoundingClientRect().right<=0);await page.screenshot({path:'work/screenshots/dashboard-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'MCP clients',exact:true}).click();await page.getByRole('heading',{name:'Hubungkan MCP client'}).waitFor();expect(errors).toEqual([]);}finally{await browser.close();}
 });
 it('stops devices and blocks new jobs on global emergency stop',async()=>{
  await data('/api/emergency-stop','POST',{enabled:true});expect((await req('/api/jobs','POST',{device_id:deviceId,tool:'terminal_run',arguments:{command:'date',args:[]},reason:'Stopped device test',idempotency_key:crypto.randomUUID()})).status).toBe(403);await data('/api/emergency-stop','POST',{enabled:false});
 });
 it('deduplicates results and never replays an ambiguously dispatched action after reconnect',async()=>{
  agent?.kill('SIGTERM');agent=undefined;await new Promise(r=>setTimeout(r,200));const cfg=JSON.parse(await readFile(join(temp,'agent.json'),'utf8'));
  const connect=async()=>{const r=await mf.dispatchFetch(origin+'/api/device/connect',{headers:{Upgrade:'websocket','X-Device-Id':deviceId,Authorization:'Bearer '+cfg.token}});expect(r.status).toBe(101);const ws=r.webSocket!;ws.accept();return ws;};
  const ws=await connect();const messages:{type:string;job?:{job_id:string}}[]=[];ws.addEventListener('message',event=>messages.push(JSON.parse(String(event.data))));
  const job=await data('/api/jobs','POST',{device_id:deviceId,tool:'terminal_run',arguments:{command:'date',args:[]},reason:'Reconnect ambiguity test',idempotency_key:'reconnect-ambiguous-001'});await waitFor(async()=>messages.some(m=>m.job?.job_id===job.job_id));
  ws.send(JSON.stringify({type:'ack',job_id:job.job_id}));ws.send(JSON.stringify({type:'result',job_id:job.job_id,result:{stdout:'first',exit_code:0}}));await waitFor(async()=>(await data('/api/jobs/'+job.job_id)).status==='completed');ws.send(JSON.stringify({type:'result',job_id:job.job_id,result:{stdout:'duplicate',exit_code:0}}));await new Promise(r=>setTimeout(r,100));expect((await data('/api/jobs/'+job.job_id)).result.stdout).toBe('first');
  const ambiguous=await data('/api/jobs','POST',{device_id:deviceId,tool:'terminal_run',arguments:{command:'date',args:[]},reason:'No automatic replay test',idempotency_key:'reconnect-ambiguous-002'});expect(ambiguous.status).toBe('dispatched');ws.close();const replacement=await connect();const replayed:string[]=[];replacement.addEventListener('message',event=>replayed.push(String(event.data)));await new Promise(r=>setTimeout(r,300));expect(replayed.some(m=>m.includes(ambiguous.job_id))).toBe(false);await data('/api/jobs/'+ambiguous.job_id+'/cancel','POST',{});replacement.close();
 });
 it('expires offline jobs and never dispatches cancelled jobs',async()=>{
  agent?.kill('SIGTERM');agent=undefined;await new Promise(r=>setTimeout(r,200));
  const j=await data('/api/jobs','POST',{device_id:deviceId,tool:'terminal_run',arguments:{command:'date',args:[]},reason:'Offline expiry test',idempotency_key:'offline-expiry-0001',ttl_seconds:5});
  await new Promise(r=>setTimeout(r,5200));expect((await data('/api/jobs/'+j.job_id)).status).toBe('expired');
  const c=await data('/api/jobs','POST',{device_id:deviceId,tool:'terminal_run',arguments:{command:'date',args:[]},reason:'Offline cancellation test',idempotency_key:'offline-cancel-0001'});await data('/api/jobs/'+c.job_id+'/cancel','POST',{});expect((await data('/api/jobs/'+c.job_id)).status).toBe('cancelled');
 });
});
