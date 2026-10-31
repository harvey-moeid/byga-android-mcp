import { DurableObject } from 'cloudflare:workers';
import { tools, validateTool, type Device, type Actor, type Job } from '../../packages/protocol';
import type { WorkflowDefinition, WorkflowRun } from './workflow';
export class DeviceRegistryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER); CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, event TEXT, subject TEXT); CREATE TABLE IF NOT EXISTS rates (key TEXT PRIMARY KEY, count INTEGER, reset INTEGER)');
  }
  async read(key: string): Promise<string | null> {
    const row = this.ctx.storage.sql.exec<{data: string; expires: number | null}>('SELECT data, expires FROM records WHERE key = ?', key).toArray()[0];
    if (!row || (row.expires && row.expires < Date.now())) return null;
    return row.data;
  }
  async put(key: string, value: unknown, expires: number | null = null) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO records VALUES (?, ?, ?)', key, JSON.stringify(value), expires); }
  async remove(key: string) { this.ctx.storage.sql.exec('DELETE FROM records WHERE key = ?', key); }
  async take(key: string): Promise<string | null> { const row = this.ctx.storage.sql.exec<{data: string}>('DELETE FROM records WHERE key=? AND (expires IS NULL OR expires > ?) RETURNING data', key, Date.now()).toArray()[0]; return row?.data ?? null; }
  async list(prefix: string): Promise<string[]> { return this.ctx.storage.sql.exec<{data: string}>('SELECT data FROM records WHERE key >= ? AND key < ? AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT 200', prefix, prefix + '\uffff', Date.now()).toArray().map(r=>r.data); }
  async updateDevice(deviceId: string, changes: Partial<Pick<Device, 'confirmed' | 'revoked' | 'stopped'>>) {
    const raw = this.ctx.storage.sql.exec<{data: string}>('SELECT data FROM records WHERE key=?', 'device:'+deviceId).toArray()[0]; if (!raw) return false; const d=JSON.parse(raw.data) as Device;
    await this.put('device:' + deviceId, {...d, ...changes}); return true;
  }
  async startRun(workflowId: string, actor: Actor): Promise<string> {
    const raw=await this.read('workflow:'+workflowId); if(!raw)throw new Error('WORKFLOW_NOT_FOUND');
    const w=JSON.parse(raw) as WorkflowDefinition;
    if(w.steps.some(s=>!actor.scopes.includes(tools[s.tool].scope)))throw new Error('PERMISSION_DENIED');
    const active=(await this.list('run:')).map(x=>JSON.parse(x) as WorkflowRun).filter(r=>r.status==='running');
    if(active.length>=20)throw new Error('RUN_LIMIT');
    const run:WorkflowRun={id:crypto.randomUUID(),workflow_id:workflowId,device_id:w.device_id,actor_id:actor.actor_id,client_id:actor.client_id,scopes:actor.scopes,status:'running',step:0,created_at:Date.now(),expires_at:Date.now()+3600000};
    await this.put('run:'+run.id,run,run.expires_at+86400000);await this.ctx.storage.setAlarm(Date.now()+1000);return JSON.stringify(run);
  }
  async cancelRun(runId: string, actor: Actor): Promise<string> {
    const raw=await this.read('run:'+runId);if(!raw)throw new Error('RUN_NOT_FOUND');const run=JSON.parse(raw) as WorkflowRun;
    if(!actor.admin&&(run.actor_id!==actor.actor_id||run.client_id!==actor.client_id))throw new Error('PERMISSION_DENIED');
    if(run.status==='running'){run.status='cancelled';await this.put('run:'+run.id,run,run.expires_at+86400000);if(run.job_id)await this.env.SESSIONS.getByName('owner:'+run.device_id).cancel(run.job_id);}
    return JSON.stringify(run);
  }
  async alarm() {
    const runs=(await this.list('run:')).map(x=>JSON.parse(x) as WorkflowRun).filter(r=>r.status==='running');
    for(const run of runs){
      try {
        const raw=await this.read('workflow:'+run.workflow_id);if(!raw)throw new Error('WORKFLOW_NOT_FOUND');const w=JSON.parse(raw) as WorkflowDefinition;
        const dr=await this.read('device:'+w.device_id);const d=dr?JSON.parse(dr) as Device:null;
        if(!d||d.revoked||d.stopped||!d.confirmed||JSON.parse(await this.read('emergency_stop')??'false'))throw new Error('DEVICE_STOPPED');
        if(run.expires_at<Date.now())throw new Error('WORKFLOW_EXPIRED');
        const session=this.env.SESSIONS.getByName('owner:'+w.device_id);
        if(run.job_id){const job=await session.job(run.job_id);if(!job)throw new Error('JOB_NOT_FOUND');if(['failed','expired','cancelled'].includes(job.status))throw new Error(job.status);if(job.status!=='completed')continue;run.step++;run.job_id=undefined;}
        if(run.step>=w.steps.length){run.status='completed';await this.put('run:'+run.id,run,run.expires_at+86400000);continue;}
        const step=w.steps[run.step];if(!run.scopes.includes(tools[step.tool].scope)||!d.capabilities.includes(step.tool))throw new Error('PERMISSION_DENIED');
        const job:Job={job_id:crypto.randomUUID(),request_id:crypto.randomUUID(),tenant_id:'owner',device_id:w.device_id,actor_id:run.actor_id,client_id:run.client_id,tool:step.tool,arguments:validateTool(step.tool,step.arguments),reason:step.reason,permission_scope:tools[step.tool].scope,created_at:Date.now(),expires_at:Date.now()+60000,status:'waiting_device',attempt:0,idempotency_key:run.id+':'+run.step};
        const current=await this.read('run:'+run.id);if(!current||JSON.parse(current).status!=='running')continue;
        const sent=await session.enqueue(job);run.job_id=sent.job_id;await this.put('job:'+sent.job_id,{device_id:w.device_id,job_id:sent.job_id},sent.expires_at+7*86400000);
        const latest=await this.read('run:'+run.id);if(!latest||JSON.parse(latest).status!=='running'){await session.cancel(sent.job_id);continue;}
      }catch(e){run.status='failed';run.error=e instanceof Error?e.message:'INTERNAL_ERROR';}
      await this.put('run:'+run.id,run,run.expires_at+86400000);
    }
    if(runs.some(r=>r.status==='running'))await this.ctx.storage.setAlarm(Date.now()+3000);
  }
  async rate(key: string, max = 120, windowMs = 60000): Promise<boolean> {
    const now = Date.now();
    this.ctx.storage.sql.exec('DELETE FROM rates WHERE reset < ?', now);
    this.ctx.storage.sql.exec('INSERT INTO rates VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now + windowMs);
    return this.ctx.storage.sql.exec<{count: number}>('SELECT count FROM rates WHERE key=?', key).one().count <= max;
  }
  async record(event: string, subject: string) { this.ctx.storage.sql.exec('INSERT INTO audit(time,event,subject) VALUES(?,?,?)', Date.now(), event, subject); this.ctx.storage.sql.exec('DELETE FROM audit WHERE seq < (SELECT MAX(seq)-2000 FROM audit)'); this.ctx.storage.sql.exec('DELETE FROM records WHERE expires IS NOT NULL AND expires < ?', Date.now()); }
  async audit() { return this.ctx.storage.sql.exec('SELECT * FROM audit ORDER BY seq DESC LIMIT 100').toArray(); }
}
