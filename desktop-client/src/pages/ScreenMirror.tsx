import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Power, Activity, MousePointerClick, Smartphone } from 'lucide-react';
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

const REQUEST_TIMEOUT_MS = 10000;
const TAP_THRESHOLD_PX = 10;
const LONG_PRESS_THRESHOLD_MS = 600;

export default function ScreenMirror({ port, device }: ScreenMirrorProps) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [casting, setCasting] = useState(false);
  const [latency, setLatency] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  // Screen size as STATE so aspect ratio updates trigger re-render
  const [screenSize, setScreenSize] = useState<{ w: number; h: number }>({
    w: device.screenWidth || 720,
    h: device.screenHeight || 1520,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const latencyStartRef = useRef<number>(0);
  const reqIdRef = useRef(0);
  const pendingRef = useRef<Map<string, (res: JsonRpcResponse) => void>>(new Map());
  const screenSizeRef = useRef(screenSize);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const [longPressActive, setLongPressActive] = useState(false);

  // Keep ref in sync for coordinate calculation
  screenSizeRef.current = screenSize;

  const wsUrl = `ws://localhost:${port}`;
  const aspectRatio = screenSize.w / screenSize.h;

  // Initialize video decoder (for future H.264 mode)
  useEffect(() => {
    if ('VideoDecoder' in window) {
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
    }
  }, []);

  // Draw PNG frame to canvas and update screen size
  const drawPng = useCallback(async (data: ArrayBuffer) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const bitmap = await createImageBitmap(new Blob([data]));
      const newW = bitmap.width;
      const newH = bitmap.height;

      // Update screen size state if changed (triggers re-render for aspect ratio)
      if (newW !== screenSizeRef.current.w || newH !== screenSizeRef.current.h) {
        setScreenSize({ w: newW, h: newH });
      }

      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      setFrameCount((c) => c + 1);
    } catch (e) {
      console.error('[ScreenMirror] PNG draw error:', e);
    }
  }, []);

  // Stable ref for WebSocket message handler
  const handleWsMessageRef = useRef<(ev: MessageEvent) => void>(() => {});
  handleWsMessageRef.current = (ev: MessageEvent) => {
    if (ev.data instanceof ArrayBuffer) {
      const arr = new Uint8Array(ev.data);
      const isPngData = arr.length >= 4 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e && arr[3] === 0x47;
      if (isPngData) {
        drawPng(ev.data);
      } else if (decoderRef.current) {
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
  };

  // WebSocket connection
  useEffect(() => {
    if (!port) return;
    setConnectionState('connecting');
    const wsInstance = new WebSocket(wsUrl);
    wsInstance.binaryType = 'arraybuffer';
    wsInstance.onopen = () => {
      setConnectionState('open');
      // Auto-start screen cast after connection
      setTimeout(() => {
        const id = `auto-${++reqIdRef.current}`;
        pendingRef.current.set(id, () => {
          setCasting(true);
          setFrameCount(0);
        });
        wsInstance.send(JSON.stringify({ id, method: 'startScreenCast' }));
      }, 300);
    };
    wsInstance.onclose = () => { setConnectionState('closed'); setCasting(false); };
    wsInstance.onerror = () => setConnectionState('error');
    wsInstance.onmessage = (ev) => handleWsMessageRef.current?.(ev);
    setWs(wsInstance);
    return () => { wsInstance.close(); setWs(null); };
  }, [port, wsUrl]);

  // JSON-RPC call helper
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
    try { await call('startScreenCast'); setCasting(true); setFrameCount(0); } catch (e) { console.error(e); }
  }, [call]);

  const handleStopCast = useCallback(async () => {
    try { await call('stopScreenCast'); setCasting(false); } catch (e) { console.error(e); }
  }, [call]);

  const handlePing = useCallback(async () => {
    latencyStartRef.current = performance.now();
    try { await call('ping'); } catch { latencyStartRef.current = 0; }
  }, [call]);

  // ===== Touch input: map mouse coords to device coords =====
  const getDeviceCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { w, h } = screenSizeRef.current;
    // canvas is displayed with CSS w-full h-full, so rect maps to device resolution
    const scaleX = w / rect.width;
    const scaleY = h / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  }, []);

  // Mouse down: start tracking touch
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // left click only
    const coords = getDeviceCoords(e.clientX, e.clientY);
    touchStartRef.current = { ...coords, time: Date.now() };
    longPressFiredRef.current = false;
    setLongPressActive(false);

    // Start long press timer
    longPressTimerRef.current = setTimeout(() => {
      if (touchStartRef.current) {
        longPressFiredRef.current = true;
        setLongPressActive(true);
      }
    }, LONG_PRESS_THRESHOLD_MS);
  }, [getDeviceCoords]);

  // Mouse move: handle drag (for swipe preview)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!touchStartRef.current) return;
    // Cancel long press if moved too far
    const coords = getDeviceCoords(e.clientX, e.clientY);
    const dx = Math.abs(coords.x - touchStartRef.current.x);
    const dy = Math.abs(coords.y - touchStartRef.current.y);
    if (dx > TAP_THRESHOLD_PX || dy > TAP_THRESHOLD_PX) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressFiredRef.current = false;
      setLongPressActive(false);
    }
  }, [getDeviceCoords]);

  // Mouse up: determine tap/swipe/longpress and execute
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    const start = touchStartRef.current;
    if (!start) return;
    touchStartRef.current = null;

    const coords = getDeviceCoords(e.clientX, e.clientY);
    const dx = Math.abs(coords.x - start.x);
    const dy = Math.abs(coords.y - start.y);
    const elapsed = Date.now() - start.time;
    const wasLongPress = longPressFiredRef.current;

    if (wasLongPress) {
      // Long press - use elapsed time as duration
      call('injectInput', { type: 'longpress', x: start.x, y: start.y, duration: elapsed }).catch(() => {});
    } else if (dx < TAP_THRESHOLD_PX && dy < TAP_THRESHOLD_PX) {
      // Tap
      call('injectInput', { type: 'tap', x: start.x, y: start.y }).catch(() => {});
    } else {
      // Swipe
      call('injectInput', {
        type: 'swipe',
        x1: start.x, y1: start.y,
        x2: coords.x, y2: coords.y,
        duration: Math.min(Math.max(elapsed, 100), 1000),
      }).catch(() => {});
    }
    longPressFiredRef.current = false;
    setLongPressActive(false);
  }, [call, getDeviceCoords]);

  // Mouse leave: cancel any ongoing touch
  const handleMouseLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
    longPressFiredRef.current = false;
    setLongPressActive(false);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const stateLabel = { idle: '待机', connecting: '连接中', open: '已连接', closed: '已断开', error: '错误' }[connectionState];
  const stateColor = connectionState === 'open' ? 'var(--success)' : connectionState === 'connecting' ? 'var(--accent)' : 'var(--text-tertiary)';

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-sm font-medium">{device.model || device.serial}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs mono text-[var(--text-tertiary)]">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
          <span style={{ color: stateColor }}>{stateLabel}</span>
        </div>
        {casting && frameCount > 0 && (
          <span className="text-xs mono text-[var(--text-tertiary)]">{frameCount}f</span>
        )}
        <span className="text-xs mono text-[var(--text-tertiary)]">{screenSize.w}x{screenSize.h}</span>
        <div className="flex-1" />
        {connectionState === 'open' && (
          <>
            {!casting ? (
              <button onClick={handleStartCast}
                className="px-3 py-1.5 bg-[var(--accent-dim)] hover:bg-[var(--accent)] text-[var(--bg-primary)] text-xs font-medium rounded flex items-center gap-1.5 transition-colors">
                <Power className="w-3 h-3" /> 投屏
              </button>
            ) : (
              <button onClick={handleStopCast}
                className="px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--danger)] hover:text-white text-[var(--text-primary)] text-xs font-medium rounded flex items-center gap-1.5 transition-colors">
                <Power className="w-3 h-3" /> 停止
              </button>
            )}
            <button onClick={handlePing}
              className="px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--border)] text-[var(--text-secondary)] text-xs mono rounded flex items-center gap-1.5 transition-colors">
              <Activity className="w-3 h-3" /> {latency > 0 ? `${latency}ms` : 'Ping'}
            </button>
          </>
        )}
      </div>

      {/* Screen mirror area */}
      <div className="flex-1 flex items-center justify-center p-4 relative scanlines overflow-hidden">
        {connectionState === 'open' ? (
          <div
            ref={containerRef}
            className="relative bg-black rounded-lg overflow-hidden shadow-2xl border border-[var(--border)]"
            style={{
              aspectRatio: `${aspectRatio}`,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onContextMenu={(e) => e.preventDefault()}
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full block"
              style={{ cursor: longPressActive ? 'grabbing' : 'crosshair' }}
            />
            {!casting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                <Monitor className="w-10 h-10 text-[var(--text-tertiary)] mb-2" strokeWidth={1} />
                <p className="text-[var(--text-secondary)] text-xs">等待投屏...</p>
              </div>
            )}
            {casting && (
              <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[10px] mono text-[var(--text-tertiary)] bg-black/60 px-2 py-0.5 rounded pointer-events-none">
                <MousePointerClick className="w-3 h-3" /> 点击/滑动/长按
              </div>
            )}
            {longPressActive && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] mono text-[var(--accent)] bg-black/60 px-2 py-0.5 rounded pointer-events-none">
                长按中...
              </div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-[var(--border)] flex items-center justify-center mx-auto mb-3">
              <Activity className="w-5 h-5 text-[var(--text-tertiary)] animate-pulse" />
            </div>
            <p className="text-[var(--text-secondary)] text-sm">{stateLabel}...</p>
          </div>
        )}
      </div>
    </div>
  );
}
