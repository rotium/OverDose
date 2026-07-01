import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { gatewayWsOrigin } from './gateway';
import { log } from './debugLog';

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
  let reconnects = 0;

  const open = () => {
    if (closed) return;
    const url = `${gatewayWsOrigin()}${path}`;
    log.debug(
      'ws',
      `${label} connecting${reconnects > 0 ? ` (reconnect #${reconnects})` : ''}`,
    );
    socket = new WebSocket(url);
    socket.onopen = () => {
      setStatus('open');
      backoff = 500;
      log.info(
        'ws',
        `${label} open${reconnects > 0 ? ` (after ${reconnects} reconnect(s))` : ''}`,
      );
      reconnects = 0;
    };
    socket.onmessage = (e) => {
      try {
        setLatest(() => JSON.parse(e.data) as T);
      } catch (err) {
        log.error('ws', `${label} bad frame`, err, e.data);
      }
    };
    socket.onerror = (e) => log.warn('ws', `${label} socket error`, e);
    socket.onclose = () => {
      setStatus('closed');
      if (closed) {
        log.debug('ws', `${label} closed (disposed)`);
        return;
      }
      reconnects++;
      log.warn('ws', `${label} closed; retry #${reconnects} in ${backoff}ms`);
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
