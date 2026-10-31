import { DurableObject } from 'cloudflare:workers';
import { canTransition, terminalStates, type Job, type JobStatus, resultSchema } from '../../packages/protocol';
export class DeviceSessionDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, idem TEXT UNIQUE, data TEXT NOT NULL, status TEXT, expires INTEGER); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  }
  private save(j: Job) { this.ctx.storage.sql.exec('UPDATE jobs SET data=?,status=?,expires=? WHERE id=?', JSON.stringify(j), j.status, j.expires_at, j.job_id); }
  async job(id: string): Promise<Job | null> { const row = this.ctx.storage.sql.exec<{data: string}>('SELECT data FROM jobs WHERE id=?', id).toArray()[0]; if (!row) return null; const j = JSON.parse(row.data) as Job; if (!terminalStates.has(j.status) && j.expires_at <= Date.now()) { j.status = 'expired'; this.save(j); } return j; }
  async jobs(): Promise<Job[]> { const rows = this.ctx.storage.sql.exec<{id: string}>("SELECT id FROM jobs ORDER BY CASE WHEN status IN ('completed','failed','cancelled','expired') THEN 1 ELSE 0 END, rowid DESC LIMIT 100").toArray(); const jobs = await Promise.all(rows.map(x => this.job(x.id))); return jobs.filter((j): j is Job => !!j); }
  async status() { return { online: this.ctx.getWebSockets().some(w => w.readyState === WebSocket.OPEN), last_seen: this.ctx.storage.sql.exec<{value: string}>('SELECT value FROM meta WHERE key=?', 'last_seen').toArray()[0]?.value ?? null }; }
  async enqueue(job: Job): Promise<Job> {
    const idem = job.actor_id + ':' + job.client_id + ':' + job.idempotency_key;
    const old = this.ctx.storage.sql.exec<{data: string}>('SELECT data FROM jobs WHERE idem=?', idem).toArray()[0];
    if (old) { const j = JSON.parse(old.data) as Job; if (JSON.stringify(j.arguments) !== JSON.stringify(job.arguments) || j.tool !== job.tool) throw new Error('IDEMPOTENCY_CONFLICT'); return (await this.job(j.job_id))!; }
    if (this.ctx.storage.sql.exec<{n: number}>("SELECT COUNT(*) n FROM jobs WHERE status NOT IN ('completed','failed','cancelled','expired')").one().n >= 50) throw new Error('QUEUE_FULL');
    this.ctx.storage.sql.exec('INSERT INTO jobs VALUES(?,?,?,?,?)', job.job_id, idem, JSON.stringify(job), job.status, job.expires_at);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    await this.dispatch(); return (await this.job(job.job_id))!;
  }
  async approve(id: string, allow: boolean) { const j = await this.job(id); if (!j || j.status !== 'waiting_approval') return null; j.status = allow ? 'waiting_device' : 'cancelled'; this.save(j); await this.dispatch(); return j; }
  async cancel(id: string) { const j = await this.job(id); if (!j || terminalStates.has(j.status)) return j; j.status = 'cancelled'; this.save(j); for (const ws of this.ctx.getWebSockets()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: 'cancel', job_id: id})); return j; }
  async stop() { for (const j of await this.jobs()) if (!terminalStates.has(j.status)) await this.cancel(j.job_id); for (const ws of this.ctx.getWebSockets()) ws.close(1008, 'Device stopped'); }
  async dispatch() {
    const ws = this.ctx.getWebSockets().find(w => w.readyState === WebSocket.OPEN); if (!ws) return;
    const rows=this.ctx.storage.sql.exec<{data:string}>("SELECT data FROM jobs WHERE status='waiting_device' ORDER BY rowid LIMIT 50").toArray();
    for (const row of rows) {
      const j=JSON.parse(row.data) as Job;
      if(j.expires_at<=Date.now()){j.status='expired';this.save(j);continue;}
      j.status = 'dispatched'; j.attempt = 1; j.dispatched_at = Date.now(); this.save(j);
      // Persist before sending. Ambiguous sends are deliberately never replayed.
      try { ws.send(JSON.stringify({type: 'job', job: j})); } catch { break; }
    }
  }
  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', {status:426});
    for (const old of this.ctx.getWebSockets()) old.close(1008, 'Connection replaced');
    const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({epoch: crypto.randomUUID()});
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta VALUES(?,?)', 'last_seen', String(Date.now()));
    pair[1].send(JSON.stringify({type:'welcome', protocol:1}));
    await this.dispatch();
    return new Response(null, {status:101, webSocket:pair[0]});
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (ws.readyState !== WebSocket.OPEN || typeof message !== 'string' || message.length > 65536) { ws.close(1009,'Invalid message'); return; }
    let data: {type?: string; job_id?: string; status?: JobStatus; result?: unknown; error?: string};
    try { data = JSON.parse(message); } catch { ws.close(1007,'Invalid JSON'); return; }
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta VALUES(?,?)', 'last_seen', String(Date.now()));
    if (data.type === 'heartbeat') { ws.send(JSON.stringify({type:'heartbeat_ack'})); return; }
    if (!data.job_id) return;
    const j = await this.job(data.job_id); if (!j) return;
    if (data.type === 'ack' && canTransition(j.status, 'acknowledged')) { j.status='acknowledged'; j.ack_at=Date.now(); this.save(j); }
    if (data.type === 'result') {
      const status = data.error ? 'failed' : 'completed';
      if (canTransition(j.status, status)) { const result=resultSchema.safeParse(data.result); if(!data.error&&!result.success){ws.close(1007,'Invalid result');return;} j.status=status; j.result=result.success?result.data:undefined; j.error=data.error?.slice(0,200); this.save(j); }
      ws.send(JSON.stringify({type:'result_ack',job_id:j.job_id}));
    }
  }
  async webSocketClose(ws: WebSocket, code: number) { ws.close(code, 'Disconnected'); }
  async webSocketError(ws: WebSocket) { ws.close(1011, 'Connection error'); }
  async alarm() {
    const active=this.ctx.storage.sql.exec<{id:string}>("SELECT id FROM jobs WHERE status NOT IN ('completed','failed','cancelled','expired')").toArray();
    const jobs=await Promise.all(active.map(j=>this.job(j.id)));
    this.ctx.storage.sql.exec("DELETE FROM jobs WHERE expires < ? AND status IN ('completed','failed','cancelled','expired')", Date.now()-7*86400000);
    if (jobs.some(j=>j&&!terminalStates.has(j.status))) await this.ctx.storage.setAlarm(Date.now()+5000);
  }
}
