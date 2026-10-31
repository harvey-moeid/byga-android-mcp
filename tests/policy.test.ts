import {describe,it,expect} from 'vitest';
import {canTransition,validateTool,path} from '../packages/protocol';
describe('default-deny policy',()=>{
 it('blocks arbitrary shell and argument injection',()=>{expect(()=>validateTool('terminal_run',{command:'sh',args:['-c','id']})).toThrow();expect(()=>validateTool('terminal_run',{command:'date',args:[';touch','x']})).toThrow();expect(validateTool('terminal_run',{command:'uname',args:['-a']})).toEqual({command:'uname',args:['-a']});});
 it('blocks traversal and absolute paths',()=>{for(const p of ['/etc/passwd','../secret','foo/../secret','foo\\..\\secret','x\0y'])expect(path.safeParse(p).success).toBe(false);expect(path.safeParse('notes/a.txt').success).toBe(true);});
 it('never replays or changes a terminal job',()=>{for(const state of ['completed','failed','cancelled','expired'] as const)expect(canTransition(state,'dispatched')).toBe(false);expect(canTransition('dispatched','waiting_device')).toBe(false);expect(canTransition('waiting_approval','dispatched')).toBe(false);expect(canTransition('dispatched','completed')).toBe(true);});
});
