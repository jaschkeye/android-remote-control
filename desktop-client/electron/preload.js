const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Device management
  getDevices: () => ipcRenderer.invoke('get-devices'),
  connectDevice: (serial) => ipcRenderer.invoke('connect-device', serial),
  disconnectDevice: (serial) => ipcRenderer.invoke('disconnect-device', serial),
  getForwardedPort: (serial) => ipcRenderer.invoke('get-forwarded-port', serial),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Device events - return unsubscribe function for cleanup
  onDevicesChanged: (callback) => {
    const handler = (_, devices) => callback(devices);
    ipcRenderer.on('devices-changed', handler);
    return () => ipcRenderer.removeListener('devices-changed', handler);
  },
  onDeviceConnected: (callback) => {
    const handler = (_, device) => callback(device);
    ipcRenderer.on('device-connected', handler);
    return () => ipcRenderer.removeListener('device-connected', handler);
  },
  onDeviceDisconnected: (callback) => {
    const handler = (_, serial) => callback(serial);
    ipcRenderer.on('device-disconnected', handler);
    return () => ipcRenderer.removeListener('device-disconnected', handler);
  },
  onDeployStatus: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('deploy-status', handler);
    return () => ipcRenderer.removeListener('deploy-status', handler);
  },
  onLog: (callback) => {
    const handler = (_, line) => callback(line);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  },

  // AI Agent control
  startAgent: (goal, config) => ipcRenderer.invoke('agent-start', goal, config),
  stopAgent: () => ipcRenderer.invoke('agent-stop'),
  getAgentStatus: () => ipcRenderer.invoke('agent-status'),

  // AI Agent events - return unsubscribe function for cleanup
  onAgentEvent: (callback) => {
    const handler = (_, event) => callback(event);
    ipcRenderer.on('agent-event', handler);
    return () => ipcRenderer.removeListener('agent-event', handler);
  },
});
