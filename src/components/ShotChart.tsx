import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  createEffect,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
} from 'solid-js';
import {
  isScaleStatusFrame,
  type MachineSnapshot,
  type ScaleMessage,
} from '../snapshot';

const BUFFER_SIZE = 600; // ~60 s at 10 Hz; bump if you want a longer window

/**
 * Real-time multi-trace chart for an in-progress shot. Three traces:
 *
 *   - pressure (bar) and flow (ml/s) — shared left y-axis (similar ranges)
 *   - weight (g) — right y-axis
 *
 * Data lives in pre-allocated typed arrays. The chart instance is owned by
 * this component; we never re-create it on snapshot updates. Reactivity is
 * only used as a trigger — the payload is passed imperatively via setData().
 */
export const ShotChart: Component<{
  machine: Accessor<MachineSnapshot | null>;
  scale: Accessor<ScaleMessage | null>;
}> = (p) => {
  let container!: HTMLDivElement;
  let chart: uPlot | undefined;

  const ts = new Float64Array(BUFFER_SIZE);
  const pressure = new Float32Array(BUFFER_SIZE);
  const flow = new Float32Array(BUFFER_SIZE);
  const weight = new Float32Array(BUFFER_SIZE);
  let len = 0;
  let t0 = 0;

  const push = (m: MachineSnapshot, w: number): void => {
    const now = performance.now() / 1000;
    if (len === 0) t0 = now;
    const x = now - t0;

    if (len < BUFFER_SIZE) {
      ts[len] = x;
      pressure[len] = m.pressure;
      flow[len] = m.flow;
      weight[len] = w;
      len++;
      return;
    }
    // Full buffer: shift one slot left, append at the end.
    ts.copyWithin(0, 1);
    pressure.copyWithin(0, 1);
    flow.copyWithin(0, 1);
    weight.copyWithin(0, 1);
    const i = BUFFER_SIZE - 1;
    ts[i] = x;
    pressure[i] = m.pressure;
    flow[i] = m.flow;
    weight[i] = w;
  };

  const currentData = (): uPlot.AlignedData => {
    if (len < BUFFER_SIZE) {
      return [
        ts.subarray(0, len),
        pressure.subarray(0, len),
        flow.subarray(0, len),
        weight.subarray(0, len),
      ];
    }
    return [ts, pressure, flow, weight];
  };

  onMount(() => {
    const opts: uPlot.Options = {
      width: container.clientWidth,
      height: 240,
      legend: { show: true },
      cursor: { drag: { x: false, y: false } },
      scales: {
        x: { time: false },
        y: { auto: true },
        yw: { auto: true },
      },
      series: [
        { label: 't' },
        {
          label: 'pressure (bar)',
          stroke: '#3b82f6',
          width: 2,
          scale: 'y',
        },
        {
          label: 'flow (ml/s)',
          stroke: '#10b981',
          width: 2,
          scale: 'y',
        },
        {
          label: 'weight (g)',
          stroke: '#f59e0b',
          width: 2,
          scale: 'yw',
        },
      ],
      axes: [
        { label: 't (s)', stroke: '#888' },
        { scale: 'y', stroke: '#888' },
        { scale: 'yw', side: 1, stroke: '#888' },
      ],
    };

    chart = new uPlot(opts, currentData(), container);

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart?.setSize({ width: entry.contentRect.width, height: 240 });
    });
    ro.observe(container);

    onCleanup(() => {
      ro.disconnect();
      chart?.destroy();
    });
  });

  // Drive the chart from the machine stream; sample latest weight at each tick.
  // The effect re-runs only when p.machine() emits — Solid does not re-render
  // this component, and the chart never touches the framework's render path.
  createEffect(() => {
    const m = p.machine();
    if (!m || !chart) return;
    const s = p.scale();
    const w = s && !isScaleStatusFrame(s) ? s.weight : NaN;
    push(m, w);
    chart.setData(currentData());
  });

  return (
    <section class="card">
      <h2>Live shot</h2>
      <div ref={container} class="chart" />
    </section>
  );
};
