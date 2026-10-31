import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { scopes, tools, id, jobInput, type Actor } from '../../packages/protocol';
import { read, list, device, findJob, listDevices, registry, session, submit } from './service';

export function mcp(request: Request, env: Env, ctx: ExecutionContext, actor: Actor) {
  const handler = createMcpHandler(async () => {
    const available=await listDevices(env);
    const server = new McpServer({name:'byga-android-mcp',version:'1.0.0'});
    const outputSchema = z.object({data:z.unknown()});
    function register(name: string, description: string, schema: z.ZodType, fn: (input: Record<string, unknown>) => Promise<unknown>) {
      server.registerTool(name,{description,inputSchema:schema,outputSchema},async (args) => {
        try { const data=await fn(args as Record<string,unknown>); return {content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:{data}}; }
        catch (e) { return {isError:true,content:[{type:'text' as const,text:e instanceof Error?e.message:'INTERNAL_ERROR'}],structuredContent:{data:{error:e instanceof Error?e.message:'INTERNAL_ERROR'}}}; }
      });
    }
    if(actor.scopes.includes('device:read')) {
      register('device_list','Daftar perangkat milik pemilik akun',z.object({}).strict(),async()=>listDevices(env));
      register('device_status','Status koneksi perangkat',z.object({device_id:id}).strict(),async a=>{await device(env,String(a.device_id));return session(env,String(a.device_id)).status();});
      register('device_capabilities','Kemampuan perangkat yang dilaporkan saat pairing',z.object({device_id:id}).strict(),async a=>(await device(env,String(a.device_id))).capabilities);
    }
    for (const [name,spec] of Object.entries(tools)) {
      if(!actor.scopes.includes(spec.scope)||!available.some(d=>d.confirmed&&!d.revoked&&d.capabilities.includes(name))) continue;
      const schema = z.object({device_id:id, arguments:spec.schema, reason:z.string().min(3).max(300),idempotency_key:z.string().min(8).max(128)}).strict();
      register(name,`${name}: ${spec.approval?'memerlukan approval pemilik; ':''}mengembalikan job asinkron, periksa terminal_job_status`,schema,async a=>submit(env,actor,jobInput.parse({...a,tool:name})));
    }
    if(actor.scopes.some(s=>scopes.includes(s as typeof scopes[number]) && s!=='device:read')) {
      const own=async(jobId:string)=>{const j=await findJob(env,jobId);if(j.actor_id!==actor.actor_id || j.client_id!==actor.client_id)throw new Error('PERMISSION_DENIED');return j;};
      register('terminal_job_status','Periksa hasil job milik client ini',z.object({job_id:id}).strict(),a=>own(String(a.job_id)));
      register('terminal_job_cancel','Batalkan job milik client ini; pembatalan perangkat bersifat best effort',z.object({job_id:id}).strict(),async a=>{const j=await own(String(a.job_id));return session(env,j.device_id).cancel(j.job_id);});
      register('approval_status','Status persetujuan job; client tidak dapat menyetujui',z.object({job_id:id}).strict(),async a=>{const j=await own(String(a.job_id));return {job_id:j.job_id,status:j.status};});
    }
    if(actor.scopes.includes('workflow:run')) {
      register('workflow_list','Daftar workflow yang dibuat pemilik',z.object({}).strict(),()=>list(registry(env),'workflow:'));
      register('workflow_run','Jalankan workflow baca secara berurutan',z.object({workflow_id:id}).strict(),async a=>JSON.parse(await registry(env).startRun(String(a.workflow_id),actor)));
      register('workflow_status','Periksa workflow run milik client ini',z.object({run_id:id}).strict(),async a=>{const r=await read<{actor_id:string;client_id:string}>(registry(env),'run:'+String(a.run_id));if(!r||r.actor_id!==actor.actor_id||r.client_id!==actor.client_id)throw new Error('PERMISSION_DENIED');return r;});
    }
    return server;
  },{route:'/mcp'});
  return handler(request,env,ctx);
}
