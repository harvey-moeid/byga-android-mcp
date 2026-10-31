import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const result={};
async function walk(dir,base=''){for(const entry of await readdir(dir,{withFileTypes:true})){const relative=join(base,entry.name);if(entry.isDirectory())await walk(join(dir,entry.name),relative);else{const contentType=entry.name.endsWith('.html')?'text/html; charset=utf-8':entry.name.endsWith('.js')?'text/javascript; charset=utf-8':entry.name.endsWith('.css')?'text/css; charset=utf-8':'text/plain';result['/'+relative]={body:await readFile(join(dir,entry.name),'utf8'),contentType};}}}
await walk('dist/dashboard');await mkdir('work',{recursive:true});await writeFile('work/dashboard-assets.json',JSON.stringify(result));
