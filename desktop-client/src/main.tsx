import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

declare global {
  interface Window {
    electronAPI: {
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
    };
  }
}

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
