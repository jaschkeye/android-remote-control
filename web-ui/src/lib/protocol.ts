export interface JsonRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  id?: string;
  result?: unknown;
  error?: { code: number; message: string };
}

let reqId = 0;
export function nextId(): string {
  return `${++reqId}`;
}

export function buildRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { id: nextId(), method, params };
}
