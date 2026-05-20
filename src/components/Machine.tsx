import { Show, type Accessor, type Component } from 'solid-js';
import type { MachineSnapshot } from '../snapshot';

export const Machine: Component<{ snapshot: Accessor<MachineSnapshot | null> }> = (p) => (
  <section class="card">
    <h2>Machine</h2>
    <Show when={p.snapshot()} fallback={<p class="muted">no data yet…</p>}>
      {(s) => (
        <dl>
          <dt>State</dt>
          <dd>{s().state.state}</dd>
          <dt>Substate</dt>
          <dd>{s().state.substate}</dd>
          <dt>Flow</dt>
          <dd>{s().flow.toFixed(2)} ml/s</dd>
          <dt>Pressure</dt>
          <dd>{s().pressure.toFixed(2)} bar</dd>
          <dt>Mix temp</dt>
          <dd>{s().mixTemperature.toFixed(1)} °C</dd>
          <dt>Group temp</dt>
          <dd>{s().groupTemperature.toFixed(1)} °C</dd>
        </dl>
      )}
    </Show>
  </section>
);
