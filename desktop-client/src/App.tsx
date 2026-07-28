import { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ScreenMirror from './pages/ScreenMirror';
import AgentPanel from './components/AgentPanel';
import type { Device, DeployStatus, AgentConfig } from './types';
import { MonitorOff, Usb } from 'lucide-react';

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<Record<string, DeployStatus>>({});
  const [agentRunning, setAgentRunning] = useState(false);
  const selectedSerialRef = useRef<string | null>(null);

  useEffect(() => {
    window.electronAPI.onDevicesChanged((devs) => {
      setDevices(devs);
      if (devs.length > 0 && !selectedSerialRef.current) {
        const connected = devs.find((d) => d.forwardedPort);
        if (connected) setSelectedSerial(connected.serial);
      }
    });
    window.electronAPI.onDeployStatus((status) => {
      setDeployStatus((prev) => ({ ...prev, [status.serial]: status }));
    });

    window.electronAPI.getDevices().then(setDevices);
  }, []);

  const handleSelect = useCallback((serial: string) => {
    selectedSerialRef.current = serial;
    setSelectedSerial(serial);
  }, []);

  const handleConnect = useCallback(async (serial: string) => {
    await window.electronAPI.connectDevice(serial);
  }, []);

  const handleAgentRun = useCallback(async (goal: string, config: AgentConfig) => {
    setAgentRunning(true);
    await window.electronAPI.startAgent(goal, config);
  }, []);

  const handleAgentStop = useCallback(async () => {
    await window.electronAPI.stopAgent();
    setAgentRunning(false);
  }, []);

  // Listen for agent done/error to update running state
  useEffect(() => {
    window.electronAPI.onAgentEvent((event) => {
      if (event.type === 'done' || event.type === 'error' || event.type === 'max-iterations') {
        setAgentRunning(false);
      }
    });
  }, []);

  const selectedDevice = devices.find((d) => d.serial === selectedSerial);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar - Device List */}
      <div className="w-64 flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col">
        <Sidebar
          devices={devices}
          selectedSerial={selectedSerial}
          onSelect={handleSelect}
          onConnect={handleConnect}
          deployStatus={deployStatus}
        />
      </div>

      {/* Center - Screen Mirror */}
      <div className="flex-1 flex flex-col grid-bg min-w-0">
        {selectedDevice?.forwardedPort ? (
          <ScreenMirror port={selectedDevice.forwardedPort} device={selectedDevice} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="text-center">
              {devices.length === 0 ? (
                <>
                  <Usb className="w-16 h-16 text-[var(--text-tertiary)] mx-auto mb-4" strokeWidth={1} />
                  <p className="text-[var(--text-secondary)] text-lg font-light mb-2">等待设备连接</p>
                  <p className="text-[var(--text-tertiary)] text-sm mono">
                    通过 USB 连接已开启调试的安卓手机
                  </p>
                  <div className="mt-8 flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)] mono">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] pulse-dot" />
                    <span>自动检测中...</span>
                  </div>
                </>
              ) : (
                <>
                  <MonitorOff className="w-16 h-16 text-[var(--text-tertiary)] mx-auto mb-4" strokeWidth={1} />
                  <p className="text-[var(--text-secondary)] text-lg font-light mb-2">设备未连接</p>
                  <p className="text-[var(--text-tertiary)] text-sm">
                    从左侧选择设备并点击连接
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right - AI Agent Panel */}
      <div className="w-80 flex-shrink-0 border-l border-[var(--border)]">
        <AgentPanel
          onRun={handleAgentRun}
          onStop={handleAgentStop}
          running={agentRunning}
        />
      </div>
    </div>
  );
}
