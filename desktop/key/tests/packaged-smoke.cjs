'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
if(process.platform!=='win32')throw new Error('The packaged smoke requires Windows x64');
const source=process.argv[2]||path.resolve(__dirname,'../dist/win-unpacked/ITSOSCup Platform.exe');
if(!fs.existsSync(source))throw new Error('Build Windows artifacts before running test:packaged');
// Portable .exe is copied to an independent empty directory. Unpacked app must
// retain its local resources; it writes diagnostics beside its own executable.
const portable=path.basename(source).startsWith('ITSOSCup-Platform-');
const root=portable?fs.mkdtempSync(path.join(os.tmpdir(),'itsoscup-key-portable-')):path.dirname(source);
const executable=portable?path.join(root,path.basename(source)):source;
if(portable)fs.copyFileSync(source,executable);
const report=path.join(root,'ITSOSCup-Platform-self-check.json');if(fs.existsSync(report))fs.unlinkSync(report);
const child=spawn(executable,['--platform-self-check'],{cwd:root,windowsHide:true,env:{...process.env},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
const deadline=Date.now()+60000;
const poll=setInterval(()=>{if(fs.existsSync(report)){finish();}else if(Date.now()>deadline){child.kill();finish(new Error('Packaged self-check timeout\n'+logs));}},250);
function finish(error){clearInterval(poll);try{if(error)throw error;const r=JSON.parse(fs.readFileSync(report,'utf8'));assert.equal(r.error,undefined);for(const key of ['loaded','trustedBridge','sandbox','contextIsolation','externalDenied','localhostDenied','filesystemDenied','arbitraryBridgeDenied','centralBridgeDenied','packaged'])assert.equal(r[key],true,key);assert.equal(r.nodeAvailable,false);assert.equal(r.background,'rgb(248, 250, 252)');assert.equal(r.status.ok,true);assert.equal(r.status.value.unlocked,false);assert.equal(r.status.value.directory,path.join(root,'ITSOSCup-Key-data'));for(const key of ['loaded','trustedBridge','keyBridgeDenied','externalDenied','backendDenied','filesystemDenied','sandbox','contextIsolation','memorySession'])assert.equal(r.platform[key],true,'platform '+key);assert.equal(r.platform.nodeAvailable,false);assert.equal(r.platform.status.error,null);assert.equal(r.platform.status.data.unlocked,false);assert.equal(r.platform.status.data.directory,path.join(root,'ITSOSCup-Platform-data'));process.stdout.write('Windows '+(portable?'portable launcher':'packaged executable')+' first-launch self-check passed: complete local platform, Key, isolated bridges, encrypted archive paths and offline security.\n');}catch(e){process.stderr.write(e.stack+'\n'+logs);process.exitCode=1;}finally{if(portable){setTimeout(()=>{try{fs.rmSync(root,{recursive:true,force:true});}catch{}},500);}else if(fs.existsSync(report))fs.unlinkSync(report);}}
