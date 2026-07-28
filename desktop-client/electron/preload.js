const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDevices: () => ipcRenderer.invoke('get-devices'),
  connectDevice: (serial) => ipcRenderer.invoke('connect-device', serial),
  disconnectDevice: (serial) => ipcRenderer.invoke('disconnect-device', serial),
  getForwardedPort: (serial) => ipcRenderer.invoke('get-forwarded-port', serial),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onDevicesChanged: (callback) => ipcRenderer.on('devices-changed', (_, devices) => callback(devices)),
  onDeviceConnected: (callback) => ipcRenderer.on('device-connected', (_, device) => callback(device)),
  onDeviceDisconnected: (callback) => ipcRenderer.on('device-disconnected', (_, serial) => callback(serial)),
  onDeployStatus: (callback) => ipcRenderer.on('deploy-status', (_, status) => callback(status)),
  onLog: (callback) => ipcRenderer.on('log', (_, line) => callback(line)),
});
