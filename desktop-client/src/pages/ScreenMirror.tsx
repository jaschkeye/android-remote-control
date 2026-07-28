import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Power, Activity, MousePointerClick } from 'lucide-react';
import type { Device } from '../types';

interface ScreenMirrorProps {
  port: number;
  device: Device;
}

interface JsonRpcResponse {
  id?: string;
  result?: unknown;
  error?: { code: number; message: string };
}

const REMOTE_WIDTH = 1280;
const REMOTE_HEIGHT = 720;
const REQUEST_TIMEOUT_MS = 10000;

export default function ScreenMirror({ port, device }: ScreenMirrorProps) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [casting, setCasting] = useState(false);
  const [latency, setLatency] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const latencyStartRef = useRef<number>(0);
  const reqIdRef = useRef(0);
  const pendingRef = useRef<Map<string, (res: JsonRpcResponse) => void>>(new Map());

  const wsUrl = `ws://localhost:${port}`;

  // Initialize WebCodecs decoder
  useEffect(() => {
    if (!('VideoDecoder' in window)) {
      console.error('WebCodecs not supported');
      return;
    }
    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            ctx.drawImage(frame, 0, 0);
          }
        }
        frame.close();
      },
      error: (e: Error) => console.error('[Decoder] error:', e),
    });
    decoder.configure({
      codec: 'avc1.640028',
      hardwareAcceleration: 'prefer-hardware',
    } as VideoDecoderConfig);
    decoderRef.current = decoder;
    return () => { decoder.close(); decoderRef.current = null; };
  }, []);

  // WebSocket message handler
  const handleWsMessage = useCallback((ev: MessageEvent) => {
    if (ev.data instanceof ArrayBuffer) {
      // Decode H.264 frame
      if (decoderRef.current) {
        const chunk = new EncodedVideoChunk({
          type: 'key',
          timestamp: performance.now(),
          data: ev.data,
        });
        decoderRef.current.decode(chunk);
      }
      if (latencyStartRef.current > 0) {
        setLatency(Math.round(performance.now() - latencyStartRef.current));
        latencyStartRef.current = 0;
      }
    } else if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id && pendingRef.current.has(msg.id)) {
          pendingRef.current.get(msg.id)!(msg);
          pendingRef.current.delete(msg.id);
        }
      } catch { /* ignore */ }
    }
  }, []);

  // Auto-connect when port changes
  useEffect(() => {
    if (!port) return;
    setConnectionState('connecting');
    const wsInstance = new WebSocket(wsUrl);
    wsInstance.binaryType = 'arraybuffer';
    wsInstance.onopen = () => setConnectionState('open');
    wsInstance.onclose = () => { setConnectionState('closed'); setCasting(false); };
    wsInstance.onerror = () => setConnectionState('error');
    wsInstance.onmessage = handleWsMessage;
    setWs(wsInstance);
    return () => { wsInstance.close(); setWs(null); };
  }, [port, wsUrl, handleWsMessage]);

  const call = useCallback((method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> => {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('WS not open')); return; }
      const id = `${++reqIdRef.current}`;
      pendingRef.current.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pendingRef.current.has(id)) { pendingRef.current.delete(id); reject(new Error('Timeout')); }
      }, REQUEST_TIMEOUT_MS);
    });
  }, [ws]);

  const handleStartCast = useCallback(async () => {
    try { await call('startScreenCast'); setCasting(true); } catch (e) { console.error(e); }
  }, [call]);

  const handleStopCast = useCallback(async () => {
    try { await call('stopScreenCast'); setCasting(false); } catch (e) { console.error(e); }
  }, [call]);

  const sendTouchAt = useCallback((e: React.MouseEvent<HTMLDivElement>, action: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = REMOTE_WIDTH / rect.width;
    const scaleY = REMOTE_HEIGHT / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    call('injectInput', { type: 'touch', action, x, y }).catch(() => {});
  }, [call]);

  const handlePing = useCallback(async () => {
    latencyStartRef.current = performance.now();
    try { await call('ping'); } catch { latencyStartRef.current = 0; }
  }, [call]);

  const stateLabel = { idle: '待机', connecting: '连接中', open: '已连接', closed: '已断开', error: '错误' }[connectionState];
  const stateColor = connectionState === 'open' ? 'var(--success)' : connectionState === 'connecting' ? 'var(--accent)' : 'var(--text-tertiary)';

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <div className="flex items-center gap-4 px-5 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-sm font-medium">{device.model || device.serial}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs mono text-[var(--text-tertiary)]">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
          <span style={{ color: stateColor }}>{stateLabel}</span>
        </div>
        <span className="text-xs mono text-[var(--text-tertiary)]">:{port}</span>

        <div className="flex-1" />

        {connectionState === 'open' && (
          <>
            {!casting ? (
              <button onClick={handleStartCast}
                className="px-3 py-1.5 bg-[var(--accent-dim)] hover:bg-[var(--accent)] text-[var(--bg-primary)] text-xs font-medium rounded flex items-center gap-1.5 transition-colors">
                <Power className="w-3 h-3" /> 开始投屏
              </button>
            ) : (
              <button onClick={handleStopCast}
                className="px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--danger)] hover:text-white text-[var(--text-primary)] text-xs font-medium rounded flex items-center gap-1.5 transition-colors">
                <Power className="w-3 h-3" /> 停止投屏
              </button>
            )}
            <button onClick={handlePing}
              className="px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border)] text-[var(--text-secondary)] text-xs mono rounded flex items-center gap-1.5 transition-colors">
              <Activity className="w-3 h-3" /> {latency > 0 ? `${latency}ms` : 'Ping'}
            </button>
          </>
        )}
      </div>

      {/* Screen Area */}
      <div className="flex-1 flex items-center justify-center p-6 relative scanlines">
        {connectionState === 'open' ? (
          <div
            className="relative bg-black rounded-xl overflow-hidden shadow-2xl cursor-crosshair border border-[var(--border)]"
            style={{ aspectRatio: '9/19.5', maxHeight: '100%', maxWidth: '100%' }}
            onMouseDown={(e) => sendTouchAt(e, 0)}
            onMouseUp={(e) => sendTouchAt(e, 1)}
          >
            <canvas ref={canvasRef} className="w-full h-full object-contain" />
            {!casting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                <Monitor className="w-12 h-12 text-[var(--text-tertiary)] mb-3" strokeWidth={1} />
                <p className="text-[var(--text-secondary)] text-sm">点击「开始投屏」</p>
                <p className="text-[var(--text-tertiary)] text-xs mono mt-1">H.264 Hardware Decode</p>
              </div>
            )}
            {casting && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-[10px] mono text-[var(--text-tertiary)] bg-black/60 px-2 py-1 rounded">
                <MousePointerClick className="w-3 h-3" /> 点击操作
              </div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full border-2 border-[var(--border)] flex items-center justify-center mx-auto mb-4">
              <Activity className="w-6 h-6 text-[var(--text-tertiary)] animate-pulse" />
            </div>
            <p className="text-[var(--text-secondary)] text-sm">{stateLabel}...</p>
          </div>
        )}
      </div>
    </div>
  );
}
