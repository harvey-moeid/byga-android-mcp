export async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
export function escapeHtml(v: string): string { return v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
export class ApiError extends Error { constructor(public code: string, public status = 400) { super(code); } }
export async function boundBody(request: Request, max = 65536): Promise<Request> {
  if (!request.body) return request;
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new ApiError('PAYLOAD_TOO_LARGE',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new Request(request,{body:bytes});
}
export async function readJson(request: Request, max = 65536): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('JSON_REQUIRED', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('INVALID_ARGUMENT');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new ApiError('PAYLOAD_TOO_LARGE', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError('INVALID_JSON'); }
}
