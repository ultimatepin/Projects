const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('riftDesktop', Object.freeze({
  copyText: (value) => ipcRenderer.invoke('clipboard:write', String(value)),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: (listener) => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('updates:state', handler)
    return () => ipcRenderer.removeListener('updates:state', handler)
  },
}))
