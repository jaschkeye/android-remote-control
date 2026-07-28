export interface Device {
  serial: string;
  state: string;
  model: string;
  androidVersion: string;
  sdk: string;
  rootAvailable: boolean;
  daemonRunning: boolean;
  forwardedPort: number | null;
}

export interface DeployStatus {
  serial: string;
  stage: 'checking' | 'pushing' | 'starting' | 'done' | 'error' | 'running';
  message: string;
}

export interface ElectronAPI {
  getDevices: () => Promise<Device[]>;
  connectDevice: (serial: string) => Promise<number | null>;
  disconnectDevice: (serial: string) => Promise<void>;
  getForwardedPort: (serial: string) => Promise<number | null>;
  openExternal: (url: string) => Promise<void>;
  onDevicesChanged: (cb: (devices: Device[]) => void) => void;
  onDeviceConnected: (cb: (device: Device) => void) => void;
  onDeviceDisconnected: (cb: (serial: string) => void) => void;
  onDeployStatus: (cb: (status: DeployStatus) => void) => void;
  onLog: (cb: (line: string) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
