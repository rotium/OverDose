import { For, Show, createMemo, type Accessor, type Component } from 'solid-js';
import { TRACE_COLOR } from './chartTraces';
import type { TraceKey, TraceVisibility } from '../prefs';

/** Legend trace declarations — mirrors the live view's legend. Colours come
 *  from `chartTraces.ts` so they never drift. */
const TRACES: Array<{
  key: TraceKey;
  name: string;
  color: string;
  suffix?: string;
}> = [
  { key: 'pressure', name: 'pressure', color: TRACE_COLOR.pressure },
  { key: 'flow', name: 'flow', color: TRACE_COLOR.flow },
  { key: 'weightFlow', name: 'weight flow', color: TRACE_COLOR.weightFlow },
  { key: 'weight', name: 'weight', color: TRACE_COLOR.weight, suffix: '÷10' },
  { key: 'mixTemp', name: 'mix temp', color: TRACE_COLOR.mixTemperature, suffix: '÷10' },
];

/**
 * The clickable chart legend (solid traces + the dashed `targets` and `steps`
 * toggles), shared by the inline shot review and the full-mode overlay so the
 * two never drift. Visibility is controlled by the host; clicking a chip calls
 * `onToggle`.
 */
export const ShotChartLegend: Component<{
  visibility: Accessor<TraceVisibility>;
  onToggle: (key: TraceKey) => void;
  /** Prefixes each chip's data-testid (e.g. "post-brew", "shot-detail"). */
  testIdPrefix: string;
}> = (p) => {
  const tid = (s: string): string => `${p.testIdPrefix}-${s}`;
  const note = (key: TraceKey, label: string) => (
    <li>
      <button
        type="button"
        class="legend-item legend-item--note"
        classList={{ 'legend-item--hidden': !p.visibility()[key] }}
        aria-pressed={p.visibility()[key]}
        aria-label={`Toggle ${label} lines`}
        data-testid={tid(`legend-${key}`)}
        onClick={() => p.onToggle(key)}
      >
        <span class="legend-swatch legend-swatch--dashed" aria-hidden="true" />
        <span class="legend-label">{label}</span>
      </button>
    </li>
  );

  return (
    <ul
      class="live-view__legend shot-review__legend"
      aria-label="Chart legend"
      data-testid={tid('legend')}
    >
      <For each={TRACES}>
        {(item) => {
          const isOn = createMemo(() => p.visibility()[item.key]);
          return (
            <li>
              <button
                type="button"
                class="legend-item"
                classList={{ 'legend-item--hidden': !isOn() }}
                aria-pressed={isOn()}
                aria-label={`Toggle ${item.name} trace`}
                data-testid={tid(`legend-${item.key}`)}
                onClick={() => p.onToggle(item.key)}
              >
                <span
                  class="legend-swatch"
                  style={{ background: item.color }}
                  aria-hidden="true"
                />
                <span class="legend-label">{item.name}</span>
                <Show when={item.suffix}>
                  <span class="legend-suffix">{item.suffix}</span>
                </Show>
              </button>
            </li>
          );
        }}
      </For>
      {note('targets', 'targets')}
      {note('steps', 'steps')}
    </ul>
  );
};
