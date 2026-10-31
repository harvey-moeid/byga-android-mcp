import {readFile,writeFile} from 'node:fs/promises';
const path='worker-configuration.d.ts';await writeFile(path,(await readFile(path,'utf8')).split('\n').map(line=>line.trimEnd()).join('\n'));
