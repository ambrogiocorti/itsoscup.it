'use strict';
// Convert the existing site favicon to a Windows icon; no new visual identity.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
app.whenReady().then(async()=>{
  const svg=fs.readFileSync(path.resolve(__dirname,'../../favicon.svg'),'utf8').replace(/<\?xml[^>]*>/,'');
  const win=new BrowserWindow({width:256,height:256,show:false,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>body{margin:0;background:white}svg{width:224px;height:224px;margin:16px}</style>'+svg));
  const svgUrl='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  const bitmap=await win.webContents.executeJavaScript('(async()=>{const img=new Image();img.src='+JSON.stringify(svgUrl)+';await img.decode();const canvas=document.createElement("canvas");canvas.width=256;canvas.height=256;const ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,256,256);ctx.drawImage(img,16,16,224,224);return canvas.toDataURL("image/png");})()');
  const png=Buffer.from(bitmap.split(',')[1],'base64'),header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  fs.mkdirSync(path.join(__dirname,'assets'),{recursive:true});fs.writeFileSync(path.join(__dirname,'assets/icon.ico'),Buffer.concat([header,png]));win.destroy();app.quit();
}).catch(error=>{process.stderr.write(error.stack);app.exit(1);});
