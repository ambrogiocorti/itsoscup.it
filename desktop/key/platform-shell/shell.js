'use strict';
function select(section){for(const id of ['open-platform','open-key'])document.getElementById(id).setAttribute('aria-pressed',String(id===(section==='key'?'open-key':'open-platform')));document.getElementById('desktop-print').hidden=section==='key';}
document.getElementById('open-platform').addEventListener('click',()=>window.itsoscupDesktop.open('platform'));
document.getElementById('open-key').addEventListener('click',()=>window.itsoscupDesktop.open('key'));
document.getElementById('desktop-home').addEventListener('click',event=>{event.preventDefault();window.itsoscupDesktop.open('home');});
document.getElementById('desktop-print').addEventListener('click',()=>window.itsoscupDesktop.print());
document.getElementById('desktop-retry').addEventListener('click',()=>window.itsoscupDesktop.retry());
window.itsoscupDesktop.onPending(state=>{const button=document.getElementById('desktop-retry');button.hidden=!state.dirty;button.title=state.message||'Reinserisci la stessa chiavetta e riprova il salvataggio centrale';});
window.itsoscupDesktop.onSection(select);
