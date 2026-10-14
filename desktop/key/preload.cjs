'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const commands = new Set(['status', 'unlock', 'restoreBackup', 'lock', 'setupSupervisor', 'login', 'logout', 'view', 'change', 'prepareSignatures', 'sign', 'finalize', 'reopen', 'addOperator', 'importPackage', 'exportResults', 'backup', 'retry', 'print']);
contextBridge.exposeInMainWorld('itsoscupKey', Object.freeze({
  call(command, args = {}) {
    if (!commands.has(command)) return Promise.reject(new Error('Azione non consentita'));
    return ipcRenderer.invoke('itsoscup-key:command', command, args);
  }
}));
