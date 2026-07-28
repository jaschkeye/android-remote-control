import { Smartphone, Shield, Wifi, Loader2, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import type { Device, DeployStatus } from '../main';

interface SidebarProps {
  devices: Device[];
  selectedSerial: string | null;
  onSelect: (serial: string) => void;
  onConnect: (serial: string) => void;
  deployStatus: Record<string, DeployStatus>;
}

function StatusDot({ device }: { device: Device }) {
  const color = device.forwardedPort
    ? 'var(--success)'
    : device.daemonRunning
    ? 'var(--accent)'
    : device.state === 'device'
    ? 'var(--text-tertiary)'
    : 'var(--danger)';
  return (
    <span
      className={`w-2 h-2 rounded-full ${device.forwardedPort ? 'pulse-dot' : ''}`}
      style={{ backgroundColor: color, color }}
    />
  );
}

function DeployIndicator({ status }: { status?: DeployStatus }) {
  if (!status) return null;
  const icons: Record<string, React.ReactNode> = {
    checking: <Loader2 className="w-3 h-3 animate-spin text-[var(--text-secondary)]" />,
    pushing: <Loader2 className="w-3 h-3 animate-spin text-[var(--accent)]" />,
    starting: <Loader2 className="w-3 h-3 animate-spin text-[var(--accent)]" />,
    done: <CheckCircle2 className="w-3 h-3 text-[var(--success)]" />,
    running: <CheckCircle2 className="w-3 h-3 text-[var(--success)]" />,
    error: <AlertCircle className="w-3 h-3 text-[var(--danger)]" />,
  };
  return (
    <div className="flex items-center gap-1.5 mt-1 ml-5">
      {icons[status.stage]}
      <span className="text-[10px] mono text-[var(--text-tertiary)]">{status.message}</span>
    </div>
  );
}

export default function Sidebar({ devices, selectedSerial, onSelect, onConnect, deployStatus }: SidebarProps) {
  return (
    <>
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center glow-accent">
            <Smartphone className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">Android Control</h1>
            <p className="text-[10px] mono text-[var(--text-tertiary)]">v0.1.0</p>
          </div>
        </div>
      </div>

      {/* Device List */}
      <div className="flex-1 overflow-y-auto py-3">
        <div className="px-5 pb-2">
          <span className="text-[10px] mono uppercase tracking-wider text-[var(--text-tertiary)]">
            设备列表 ({devices.length})
          </span>
        </div>

        {devices.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-[var(--text-tertiary)]">等待 USB 设备...</p>
          </div>
        ) : (
          devices.map((device) => (
            <div key={device.serial} className="slide-in">
              <button
                onClick={() => onSelect(device.serial)}
                className={`w-full text-left px-5 py-3 transition-all border-l-2 ${
                  selectedSerial === device.serial
                    ? 'bg-[var(--bg-tertiary)] border-[var(--accent)]'
                    : 'border-transparent hover:bg-[var(--bg-tertiary)]/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <StatusDot device={device} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {device.model || device.serial}
                      </span>
                      {device.rootAvailable && (
                        <Shield className="w-3 h-3 text-[var(--accent)]" strokeWidth={2.5} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] mono text-[var(--text-tertiary)] truncate">
                        {device.serial}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {device.androidVersion && (
                        <span className="text-[10px] mono text-[var(--text-tertiary)]">
                          Android {device.androidVersion}
                        </span>
                      )}
                      {device.forwardedPort && (
                        <span className="text-[10px] mono text-[var(--success)] flex items-center gap-0.5">
                          <Wifi className="w-2.5 h-2.5" />
                          :{device.forwardedPort}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight
                    className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${
                      selectedSerial === device.serial ? 'rotate-90' : ''
                    }`}
                  />
                </div>
              </button>

              {/* Deploy status */}
              <DeployIndicator status={deployStatus[device.serial]} />

              {/* Connect button */}
              {selectedSerial === device.serial && !device.forwardedPort && (
                <button
                  onClick={() => onConnect(device.serial)}
                  className="mx-5 mt-2 px-3 py-1.5 bg-[var(--accent-dim)] hover:bg-[var(--accent)] text-[var(--bg-primary)] text-xs font-medium rounded transition-colors flex items-center gap-1.5"
                >
                  <Wifi className="w-3 h-3" />
                  连接并部署
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)]">
        <div className="flex items-center justify-between text-[10px] mono text-[var(--text-tertiary)]">
          <span>ADB Auto-detect</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] pulse-dot" />
            Active
          </span>
        </div>
      </div>
    </>
  );
}
