import { z } from 'zod';
export const workflowSchema=z.object({name:z.string().min(1).max(80),device_id:z.string().uuid(),steps:z.array(z.object({tool:z.enum(['terminal_run','files_list','files_read']),arguments:z.record(z.string(),z.unknown()),reason:z.string().min(3).max(300)}).strict()).min(1).max(20)}).strict();
export type WorkflowDefinition=z.infer<typeof workflowSchema>&{id:string};
export interface WorkflowRun {id:string;workflow_id:string;device_id:string;actor_id:string;client_id:string;scopes:string[];status:'running'|'completed'|'failed'|'cancelled';step:number;job_id?:string;error?:string;created_at:number;expires_at:number;}
