import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for(const file of ['class.html','admin/index.html']){
  const content=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const parts=[...content.matchAll(/<script\s+type="module"[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(parts.length>0, file+' must contain its application module');
  for(const [,code] of parts){
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8'});
    assert.equal(result.status,0,file+' inline JavaScript syntax: '+result.stderr);
  }
}
console.log('Class portal and integrated admin boot syntax checks passed.');
