import { z } from 'zod';

export const scopes = ['device:read', 'terminal:run', 'files:read', 'files:write', 'android:read', 'android:control', 'workflow:run'] as const;
export const id = z.string().uuid();
export const path = z.string().min(1).max(256).refine(p => !p.startsWith('/') && !p.split(/[\\/]/).some(x => x === '..') && !p.includes('\0'), 'Path harus relatif terhadap workspace');
export const command = z.enum(['pwd', 'date', 'uname', 'uptime', 'whoami', 'termux-battery-status']);
export const tools = {
  terminal_run: { scope: 'terminal:run', approval: false, schema: z.object({ command, args: z.array(z.string().max(128)).max(2).default([]) }).strict() },
  files_list: { scope: 'files:read', approval: false, schema: z.object({ path: path.default('.') }).strict() },
  files_read: { scope: 'files:read', approval: false, schema: z.object({ path }).strict() },
  files_write: { scope: 'files:write', approval: true, schema: z.object({ path, content: z.string().max(32768) }).strict() },
  files_delete: { scope: 'files:write', approval: true, schema: z.object({ path }).strict() },
  android_ui_tree: { scope: 'android:read', approval: true, schema: z.object({}).strict() },
  android_screenshot: { scope: 'android:read', approval: true, schema: z.object({}).strict() },
  android_tap: { scope: 'android:control', approval: true, schema: z.object({ x: z.number().int().min(0).max(10000), y: z.number().int().min(0).max(10000) }).strict() },
  android_swipe: { scope: 'android:control', approval: true, schema: z.object({ x: z.number().int().min(0).max(10000), y: z.number().int().min(0).max(10000), to_x: z.number().int().min(0).max(10000), to_y: z.number().int().min(0).max(10000), duration_ms: z.number().int().min(100).max(2000).default(300) }).strict() },
  android_input_text: { scope: 'android:control', approval: true, schema: z.object({ text: z.string().max(2000) }).strict() },
  android_press_key: { scope: 'android:control', approval: true, schema: z.object({ key: z.enum(['back', 'home', 'recents']) }).strict() },
  android_open_app: { scope: 'android:control', approval: true, schema: z.object({ package: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/).max(200) }).strict() }
} as const;
export type JsonObject = Record<string, string | number | boolean | string[]>;
export const resultSchema = z.object({stdout:z.string().max(32768).optional(),stderr:z.string().max(32768).optional(),exit_code:z.number().int().optional(),duration_ms:z.number().optional(),content:z.string().max(32768).optional(),entries:z.array(z.object({name:z.string(),directory:z.boolean(),size:z.number()})).max(200).optional(),ui_tree:z.string().max(32768).optional(),ok:z.boolean().optional()}).strict();
export type AgentResult = z.infer<typeof resultSchema>;
export type Tool = keyof typeof tools;
export const jobInput = z.object({ device_id: id, tool: z.enum(Object.keys(tools) as [Tool, ...Tool[]]), arguments: z.record(z.string(), z.unknown()).default({}), reason: z.string().min(3).max(300), idempotency_key: z.string().min(8).max(128), ttl_seconds: z.number().int().min(5).max(300).default(60) }).strict();
export type JobInput = z.infer<typeof jobInput>;
export type JobStatus = 'waiting_device' | 'waiting_approval' | 'dispatched' | 'acknowledged' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
export interface Job { job_id: string; request_id: string; tenant_id: string; device_id: string; actor_id: string; client_id: string; tool: Tool; arguments: JsonObject; reason: string; permission_scope: string; created_at: number; expires_at: number; status: JobStatus; attempt: number; idempotency_key: string; result?: AgentResult; error?: string; dispatched_at?: number; ack_at?: number; }
export interface Device { device_id: string; name: string; platform: string; capabilities: string[]; confirmed: boolean; revoked: boolean; stopped: boolean; created_at: number; credential_hash: string; }
export interface Actor { tenant_id: string; actor_id: string; client_id: string; scopes: string[]; admin: boolean; }
export const terminalStates = new Set<JobStatus>(['completed', 'failed', 'cancelled', 'expired']);
export function validateTool(tool: Tool, args: unknown): JsonObject {
  const value = tools[tool].schema.parse(args);
  if (tool === 'terminal_run') {
    const a = value as { command: string; args: string[] };
    if (a.args.length && !(a.command === 'uname' && a.args.length === 1 && a.args[0] === '-a')) throw new Error('COMMAND_NOT_ALLOWED');
  }
  return value as JsonObject;
}
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (terminalStates.has(from)) return false;
  if (to === 'expired' || to === 'cancelled' || to === 'failed') return true;
  return ({ waiting_approval: ['waiting_device'], waiting_device: ['dispatched'], dispatched: ['acknowledged', 'running', 'completed'], acknowledged: ['running', 'completed'], running: ['completed'] } as Partial<Record<JobStatus, JobStatus[]>>)[from]?.includes(to) ?? false;
}
