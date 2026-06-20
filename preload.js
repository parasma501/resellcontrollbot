const { contextBridge, ipcRenderer } = require('electron');

const DEFAULT_API_BASE = 'https://resellcontrollbot.onrender.com';
const env = typeof process === 'object' && process && process.env ? process.env : {};
const argv = typeof process === 'object' && process && Array.isArray(process.argv) ? process.argv : [];
const appVersionArg = argv.find(arg => arg.startsWith('--app-version='));
const appVersion = appVersionArg ? appVersionArg.slice('--app-version='.length) : '0.0.0';

contextBridge.exposeInMainWorld('desktopApi', Object.freeze({
    appVersion,
    apiBase: env.API_BASE || DEFAULT_API_BASE,
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    saveRental: (rental) => ipcRenderer.send('notify-rental-created', rental),
    getSession: () => ipcRenderer.invoke('session:get'),
    setSession: (token) => ipcRenderer.invoke('session:set', token),
    clearSession: () => ipcRenderer.invoke('session:clear')
}));
