import { createSignal, onCleanup, type Accessor } from 'solid-js';

export type WsStatus = 'connecting' | 'open' | 'closed';

export interface WsStream<T> {
  latest: Accessor<T | null>;
  status: Accessor<WsStatus>;
}

/**
 * Subscribe to a gateway WebSocket and expose the latest parsed message + status
 * as Solid signals. Auto-reconnects with exponential backoff (capped at 5s).
 * Cleans up on owner disposal — call inside a component body or createRoot.
 */
export function createWsStream<T>(path: string, label: string): WsStream<T> {
  const [latest, setLatest] = createSignal<T | null>(null);
  const [status, setStatus] = createSignal<WsStatus>('connecting');

  let socket: WebSocket | null = null;
  let closed = false;
  let backoff = 500;
  let retryTimer: number | undefined;

  const open = () => {
    if (closed) return;
    const url = `${location.origin.replace(/^http/, 'ws')}${path}`;
    socket = new WebSocket(url);
    socket.onopen = () => {
      setStatus('open');
      backoff = 500;
      console.log(`[${label}] open`);
    };
    socket.onmessage = (e) => {
      try {
        setLatest(() => JSON.parse(e.data) as T);
      } catch (err) {
        console.warn(`[${label}] bad frame`, err, e.data);
      }
    };
    socket.onerror = (e) => console.warn(`[${label}] error`, e);
    socket.onclose = () => {
      setStatus('closed');
      console.log(`[${label}] closed; retrying in ${backoff}ms`);
      if (closed) return;
      retryTimer = window.setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 5_000);
    };
  };

  open();

  onCleanup(() => {
    closed = true;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    socket?.close();
  });

  return { latest, status };
}
