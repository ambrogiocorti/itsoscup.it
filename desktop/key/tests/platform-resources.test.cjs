'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { createHash } = require('node:crypto');
const { loadResources, canonicalResource, isPlatformPage } = require('../platform-resources.cjs');
test('platform resources reject other origins, paths outside manifest, encoded separators and credentialed URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'itsoscup-resource-test-'));
  try { const data = Buffer.from('<!doctype html><title>safe</title>'); fs.writeFileSync(path.join(root,'index.html'),data); fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({resources:{'/index.html':{size:data.length,sha256:createHash('sha256').update(data).digest('hex')}}})); const { resources } = loadResources(root);
    assert.ok(isPlatformPage('platform://app/',resources)); assert.ok(canonicalResource('platform://app/index.html?team=17#view',resources));
    for (const url of ['platform://other/index.html','platform://user:secret@app/index.html','platform://app:42/index.html','file:///C:/Windows/win.ini','platform://app/%69ndex.html','platform://app/../../secret.env','platform://app/node_modules/sql.js/package.json']) assert.equal(canonicalResource(url,resources),null,url);
    fs.writeFileSync(path.join(root,'index.html'),'tampered'); assert.throws(()=>loadResources(root),/integrity/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
