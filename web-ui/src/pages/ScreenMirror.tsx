import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import VideoDecoder, { type VideoDecoderHandle } from '../components/VideoDecoder';
import { Monitor, Power, Wifi } from 'lucide-react';

const WS_URL = 'ws://192.168.1.100:27183';

export default function ScreenMirror() {
  const { connect, disconnect, call, state, ws } = useWebSocket(WS_URL);
  const [deviceIp, setDeviceIp] = useState('192.168.1.100');
  const [casting, setCasting] = useState(false);
  const [latency, setLatency] = useState(0);
  const decoderRef = useRef<VideoDecoderHandle>(null);
  const latencyStartRef = useRef<number>(0);

  useEffect(() => {
    const wsInstance = ws.current;
    if (!wsInstance) return;

    const handleMessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        decoderRef.current?.decodeChunk(ev.data);
        if (latencyStartRef.current > 0) {
          setLatency(Math.round(performance.now() - latencyStartRef.current));
          latencyStartRef.current = 0;
        }
      }
    };

    wsInstance.addEventListener('message', handleMessage);
    return () => wsInstance.removeEventListener('message', handleMessage);
  }, [ws]);

  const handleConnect = useCallback(() => {
    connect();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setCasting(false);
  }, [disconnect]);

  const handleStartCast = useCallback(async () => {
    try {
      await call('startScreenCast');
      setCasting(true);
    } catch (e) {
      console.error('startScreenCast failed', e);
    }
  }, [call]);

  const handleStopCast = useCallback(async () => {
    try {
      await call('stopScreenCast');
      setCasting(false);
    } catch (e) {
      console.error('stopScreenCast failed', e);
    }
  }, [call]);

  const sendTouch = useCallback(
    async (action: number, x: number, y: number) => {
      try {
        await call('injectInput', { type: 'touch', action, x, y });
      } catch {
        /* ignore */
      }
    },
    [call]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const scaleX = 1280 / rect.width;
      const scaleY = 720 / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      sendTouch(0, x, y); // ACTION_DOWN = 0
    },
    [sendTouch]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const scaleX = 1280 / rect.width;
      const scaleY = 720 / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      sendTouch(1, x, y); // ACTION_UP = 1
    },
    [sendTouch]
  );

  const handlePing = useCallback(async () => {
    latencyStartRef.current = performance.now();
    try {
      await call('ping');
    } catch {
      latencyStartRef.current = 0;
    }
  }, [call]);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <Monitor className="w-5 h-5 text-blue-400" />
        <h1 className="font-semibold text-sm">Android Remote Control</h1>
        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <Wifi className="w-4 h-4 text-gray-400" />
          <input
            value={deviceIp}
            onChange={(e) => setDeviceIp(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-32"
            placeholder="IP 地址"
          />
        </div>

        {state !== 'open' ? (
          <button
            onClick={handleConnect}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition"
          >
            连接
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs font-medium transition"
          >
            断开
          </button>
        )}

        {state === 'open' && (
          <>
            {!casting ? (
              <button
                onClick={handleStartCast}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs font-medium transition flex items-center gap-1"
              >
                <Power className="w-3 h-3" />
                开始投屏
              </button>
            ) : (
              <button
                onClick={handleStopCast}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-xs font-medium transition flex items-center gap-1"
              >
                <Power className="w-3 h-3" />
                停止投屏
              </button>
            )}
            <button
              onClick={handlePing}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium transition"
            >
              测延迟 {latency > 0 ? `${latency}ms` : ''}
            </button>
          </>
        )}

        <span
          className={`text-xs px-2 py-0.5 rounded ${
            state === 'open'
              ? 'bg-green-900 text-green-300'
              : state === 'connecting'
              ? 'bg-yellow-900 text-yellow-300'
              : 'bg-gray-800 text-gray-400'
          }`}
        >
          {state === 'idle' && '未连接'}
          {state === 'connecting' && '连接中'}
          {state === 'open' && '已连接'}
          {state === 'closed' && '已断开'}
          {state === 'error' && '错误'}
        </span>
      </div>

      {/* Screen Area */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        {state === 'open' ? (
          <div
            className="relative bg-black rounded-lg overflow-hidden shadow-2xl cursor-crosshair"
            style={{ aspectRatio: '9/19.5', maxHeight: '90vh', maxWidth: '100%' }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          >
            <VideoDecoder ref={decoderRef} className="w-full h-full object-contain" />
            {!casting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <p className="text-gray-400 text-sm">点击「开始投屏」启动画面传输</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <Monitor className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 text-sm mb-2">未连接到设备</p>
            <p className="text-gray-600 text-xs">输入手机 IP 地址后点击「连接」</p>
          </div>
        )}
      </div>
    </div>
  );
}
