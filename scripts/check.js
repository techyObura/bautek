import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const files=[];function walk(p){for(const e of readdirSync(p,{withFileTypes:true})){const f=join(p,e.name);if(e.isDirectory())walk(f);else if(f.endsWith('.js'))files.push(f);}}
walk('src');walk('scripts');walk('tests');let errors=0;
for(const f of files){const out=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(out.status){console.error(f,out.stderr);errors++;}}
console.log(`Syntax checked ${files.length} JavaScript files; ${errors} errors`);process.exit(errors?1:0);
