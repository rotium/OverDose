import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { createEffect, onCleanup, onMount, type Accessor, type Component } from 'solid-js';
import type { GatewayShotRecord } from '../api';

/**
 * Frozen-trace mini chart for a completed shot. Unlike ShotChart (which
 * streams), this is one-shot: when a shot record arrives, build the data
 * arrays, set them once, and never push again.
 *
 * Pressure on left axis; weight on right. We omit flow on the mini to keep
 * the trace readable at small size.
 */
export const ShotMiniChart: Component<{
  shot: Accessor<GatewayShotRecord | null>;
}> = (p) => {
  let container!: HTMLDivElement;
  let chart: uPlot | undefined;

  const buildData = (rec: GatewayShotRecord): uPlot.AlignedData => {
    if (!rec.measurements.length) return [[], [], []];
    const t0 = Date.parse(rec.measurements[0]!.machine.timestamp) / 1000;
    const ts: number[] = [];
    const pressure: number[] = [];
    const weight: number[] = [];
    for (const m of rec.measurements) {
      ts.push(Date.parse(m.machine.timestamp) / 1000 - t0);
      pressure.push(m.machine.pressure);
      weight.push(m.scale?.weight ?? NaN);
    }
    return [ts, pressure, weight];
  };

  onMount(() => {
    const opts: uPlot.Options = {
      width: container.clientWidth || 280,
      height: 80,
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, show: false },
      scales: {
        x: { time: false },
        y: { auto: true },
        yw: { auto: true },
      },
      series: [
        {},
        { stroke: '#3b82f6', width: 1.5, scale: 'y', points: { show: false } },
        { stroke: '#f59e0b', width: 1.5, scale: 'yw', points: { show: false } },
      ],
      axes: [{ show: false }, { show: false }, { show: false, scale: 'yw' }],
    };
    chart = new uPlot(opts, [[], [], []], container);

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart?.setSize({ width: entry.contentRect.width, height: 80 });
    });
    ro.observe(container);

    onCleanup(() => {
      ro.disconnect();
      chart?.destroy();
    });
  });

  createEffect(() => {
    const rec = p.shot();
    if (!rec || !chart) return;
    chart.setData(buildData(rec));
  });

  return <div ref={container} class="mini-chart" data-testid="shot-mini-chart" />;
};
