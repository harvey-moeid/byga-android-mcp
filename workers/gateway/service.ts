import { ApiError, hash } from '../../packages/auth';
import { tools, validateTool, type Actor, type Device, type Job, type JobInput } from '../../packages/protocol';
export function registry(env: Env) { return env.REGISTRY.getByName('owner'); }
export async function read<T>(reg: ReturnType<typeof registry>, key: string): Promise<T | null> { const value=await reg.read(key); return value === null ? null : JSON.parse(value) as T; }
export async function list<T>(reg: ReturnType<typeof registry>, key: string): Promise<T[]> { return (await reg.list(key)).map(value=>JSON.parse(value) as T); }
export function session(env: Env, deviceId: string) { return env.SESSIONS.getByName('owner:' + deviceId); }
export async function device(env: Env, deviceId: string): Promise<Device> {
  const d = await read<Device>(registry(env),'device:' + deviceId);
  if (!d || d.revoked) throw new ApiError('DEVICE_NOT_FOUND', 404);
  return d;
}
export async function submit(env: Env, actor: Actor, input: JobInput): Promise<Job> {
  const reg = registry(env); const d = await device(env, input.device_id);
  if (!d.confirmed || d.stopped || await read<boolean>(reg,'emergency_stop')) throw new ApiError('DEVICE_STOPPED', 403);
  const spec = tools[input.tool];
  if (!actor.scopes.includes(spec.scope)) throw new ApiError('PERMISSION_DENIED', 403);
  if (!d.capabilities.includes(input.tool)) throw new ApiError('DEVICE_CAPABILITY_UNAVAILABLE', 409);
  const args = validateTool(input.tool, input.arguments);
  const j: Job = { job_id: crypto.randomUUID(), request_id: crypto.randomUUID(), tenant_id: actor.tenant_id, device_id: d.device_id, actor_id: actor.actor_id, client_id: actor.client_id, tool: input.tool, arguments: args, reason: input.reason, permission_scope: spec.scope, created_at:Date.now(), expires_at:Date.now()+input.ttl_seconds*1000, status:spec.approval?'waiting_approval':'waiting_device', attempt:0, idempotency_key:input.idempotency_key };
  const result = await session(env, d.device_id).enqueue(j);
  await reg.put('job:' + result.job_id, {device_id:d.device_id, job_id:result.job_id}, result.expires_at + 7*86400000);
  await reg.record('job_requested:' + input.tool, result.job_id);
  return result;
}
export async function findJob(env: Env, id: string) {
  const index = await read<{device_id:string}>(registry(env),'job:' + id);
  if (!index) throw new ApiError('JOB_NOT_FOUND',404);
  const job = await session(env,index.device_id).job(id);
  if (!job) throw new ApiError('JOB_NOT_FOUND',404);
  return job;
}
export async function listDevices(env: Env) {
  const devices = await list<Device>(registry(env),'device:');
  return Promise.all(devices.map(async d => { const {credential_hash: _hash, ...safe}=d; return {...safe,...await session(env,d.device_id).status()}; }));
}
export async function authenticateDevice(request: Request, env: Env) {
  const id = request.headers.get('X-Device-Id'); const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if (!id || !token) throw new ApiError('UNAUTHORIZED',401);
  const d=await device(env,id);
  if (await hash(token) !== d.credential_hash || !d.confirmed || d.stopped || await read<boolean>(registry(env),'emergency_stop')) throw new ApiError('PERMISSION_DENIED',403);
  return d;
}
