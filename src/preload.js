const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Session management
  getSessions: () => ipcRenderer.invoke('get-focus-sessions'),
  startSession: (settings) => ipcRenderer.invoke('start-focus-session', settings),
  stopSession: () => ipcRenderer.invoke('stop-focus-session'),
  
  // App management
  showAppPicker: () => ipcRenderer.invoke('show-app-picker'),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  
  // Block list management
  getBlockList: () => ipcRenderer.invoke('get-block-list'),
  addToBlockList: (appName) => ipcRenderer.invoke('add-to-block-list', appName),
  removeFromBlockList: (appName) => ipcRenderer.invoke('remove-from-block-list', appName),
  
  // System info
  platform: process.platform
});