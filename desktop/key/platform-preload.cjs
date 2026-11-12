'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('itsoscupPlatform', Object.freeze({
  call(request) { return ipcRenderer.invoke('itsoscup-platform:api', request); },
  openKey() { return ipcRenderer.invoke('itsoscup-platform:key-open'); },
  onChange(callback) { if (typeof callback === 'function') ipcRenderer.on('itsoscup-platform:changed', (_event, change) => callback(change)); }
}));
