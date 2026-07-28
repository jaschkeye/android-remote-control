export interface Device {
  serial: string;
  state: string;
  model: string;
  androidVersion: string;
  sdk: string;
  rootAvailable: boolean;
  daemonRunning: boolean;
  forwardedPort: number | null;
  screenWidth: number;
  screenHeight: number;
}

export interface DeployStatus {
  serial: string;
  stage: 'checking' | 'pushing' | 'starting' | 'done' | 'error' | 'running';
  message: string;
}

export interface AgentConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxIterations: number;
}

export type AgentEventType =
  | 'start'
  | 'screenshot'
  | 'thinking'
  | 'action'
  | 'done'
  | 'error'
  | 'max-iterations'
  | 'log';

export interface AgentEvent {
  type: AgentEventType;
  iteration?: number;
  action?: Record<string, unknown>;
  result?: { success: boolean; detail: string };
  summary?: string;
  imageBase64?: string;
  message?: string;
  goal?: string;
  iterations?: number;
}

export interface ElectronAPI {
  // Device management
  getDevices: () => Promise<Device[]>;
  connectDevice: (serial: string) => Promise<number | null>;
  disconnectDevice: (serial: string) => Promise<void>;
  getForwardedPort: (serial: string) => Promise<number | null>;
  openExternal: (url: string) => Promise<void>;

  // Device events - return unsubscribe function
  onDevicesChanged: (cb: (devices: Device[]) => void) => () => void;
  onDeviceConnected: (cb: (device: Device) => void) => () => void;
  onDeviceDisconnected: (cb: (serial: string) => void) => () => void;
  onDeployStatus: (cb: (status: DeployStatus) => void) => () => void;
  onLog: (cb: (line: string) => void) => () => void;

  // AI Agent
  startAgent: (goal: string, config: AgentConfig) => Promise<void>;
  stopAgent: () => Promise<void>;
  getAgentStatus: () => Promise<{ running: boolean; iteration: number }>;
  onAgentEvent: (cb: (event: AgentEvent) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
