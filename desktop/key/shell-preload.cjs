'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('itsoscupDesktop', Object.freeze({
  open(section) { return ipcRenderer.invoke('itsoscup-platform:open', section); },
  retry() { return ipcRenderer.invoke('itsoscup-platform:retry'); },
  onPending(callback) { if (typeof callback === 'function') ipcRenderer.on('itsoscup-platform:pending', (_event, state) => callback(state)); },
  onSection(callback) { if (typeof callback === 'function') ipcRenderer.on('itsoscup-platform:section', (_event, section) => callback(section)); }
}));
