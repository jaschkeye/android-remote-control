import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRequest, type JsonRpcRequest, type JsonRpcResponse } from '../lib/protocol';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface WsMessage {
  type: 'json' | 'binary';
  data: string | ArrayBuffer | Blob;
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnectionState>('idle');
  const pendingRef = useRef<Map<string, (res: JsonRpcResponse) => void>>(new Map());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setState('connecting');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setState('open');
      console.log('[WS] Connected');
    };
    ws.onclose = () => {
      setState('closed');
      wsRef.current = null;
    };
    ws.onerror = () => {
      setState('error');
      wsRef.current = null;
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as JsonRpcResponse;
          if (msg.id && pendingRef.current.has(msg.id)) {
            pendingRef.current.get(msg.id)!(msg);
            pendingRef.current.delete(msg.id);
          }
        } catch {
          /* ignore non-JSON text */
        }
      }
    };

    wsRef.current = ws;
  }, [url]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState('closed');
  }, []);

  const send = useCallback((req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not open'));
        return;
      }
      pendingRef.current.set(req.id, resolve);
      ws.send(JSON.stringify(req));
      setTimeout(() => {
        if (pendingRef.current.has(req.id)) {
          pendingRef.current.delete(req.id);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }, []);

  const sendBinary = useCallback((data: ArrayBuffer | Blob) => {
    wsRef.current?.send(data);
  }, []);

  const call = useCallback(
    async (method: string, params?: Record<string, unknown>) => {
      const req = buildRequest(method, params);
      return send(req);
    },
    [send]
  );

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { connect, disconnect, send, sendBinary, call, state, ws: wsRef };
}
