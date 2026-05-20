import { api } from './api';
import {
  isScaleStatusFrame,
  type MachineSnapshot,
  type ScaleMessage,
} from './snapshot';
import { renderMachine, renderScale, renderScaleStatus, setConnection } from './ui';

// Reconnecting WebSocket helper. Returns a function to close.
function connect<T>(path: string, onMessage: (msg: T) => void, label: string): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let backoff = 500;

  const open = () => {
    if (closed) return;
    const url = `${location.origin.replace(/^http/, 'ws')}${path}`;
    socket = new WebSocket(url);
    socket.onopen = () => {
      console.log(`[${label}] open`);
      backoff = 500;
      if (label === 'machine') setConnection('open');
    };
    socket.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data) as T);
      } catch (err) {
        console.warn(`[${label}] bad frame`, err, e.data);
      }
    };
    socket.onerror = (e) => console.warn(`[${label}] error`, e);
    socket.onclose = () => {
      console.log(`[${label}] closed, retrying in ${backoff}ms`);
      if (label === 'machine') setConnection('closed');
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 5_000);
    };
  };

  open();
  return () => {
    closed = true;
    socket?.close();
  };
}

function main(): void {
  setConnection('connecting');

  connect<MachineSnapshot>('/ws/v1/machine/snapshot', renderMachine, 'machine');
  connect<ScaleMessage>(
    '/ws/v1/scale/snapshot',
    (msg) => {
      if (isScaleStatusFrame(msg)) renderScaleStatus(msg);
      else renderScale(msg);
    },
    'scale',
  );

  document.getElementById('tare')?.addEventListener('click', () => {
    api.tareScale().catch((e) => console.warn('tare failed', e));
  });

  // Surface basic info on load — useful sanity check that REST works too.
  api
    .machineInfo()
    .then((info) => console.log('machine info', info))
    .catch((e) => console.warn('machine info failed', e));
}

main();
