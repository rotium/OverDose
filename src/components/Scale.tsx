import { createMemo, type Accessor, type Component } from 'solid-js';
import { api } from '../api';
import {
  isScaleStatusFrame,
  type ScaleMessage,
  type ScaleSnapshot,
} from '../snapshot';

type ScaleConn = 'connected' | 'disconnected' | 'unknown';

export const Scale: Component<{ message: Accessor<ScaleMessage | null> }> = (p) => {
  // Track connection status and latest data frame independently — the WS keeps
  // streaming across scale connect/disconnect cycles per Skins.md.
  const status = createMemo<ScaleConn>((prev) => {
    const m = p.message();
    if (!m) return prev;
    return isScaleStatusFrame(m) ? m.status : 'connected';
  }, 'unknown' as ScaleConn);

  const data = createMemo<ScaleSnapshot | null>((prev) => {
    const m = p.message();
    if (!m || isScaleStatusFrame(m)) return prev;
    return m;
  }, null as ScaleSnapshot | null);

  const tare = () =>
    api.tareScale().catch((e) => console.warn('tare failed', e));

  return (
    <section class="card">
      <h2>Scale</h2>
      <dl>
        <dt>Status</dt>
        <dd>{status()}</dd>
        <dt>Weight</dt>
        <dd>{data() ? `${data()!.weight.toFixed(2)} g` : '—'}</dd>
        <dt>Battery</dt>
        <dd>{data() ? `${data()!.batteryLevel}%` : '—'}</dd>
      </dl>
      <button type="button" onClick={tare} disabled={status() !== 'connected'}>
        Tare
      </button>
    </section>
  );
};
