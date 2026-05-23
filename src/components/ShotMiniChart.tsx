import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { createEffect, onCleanup, onMount, type Accessor, type Component } from 'solid-js';
import type { GatewayShotRecord } from '../api';
import { TRACE_COLOR, TRACE_TRANSFORM } from './chartTraces';

/**
 * Frozen-trace mini chart for a completed shot. Unlike `LiveShotChart`
 * (which streams), this is one-shot: when a shot record arrives, build
 * the data arrays, set them once, and never push again.
 *
 * Renders the same five solid traces as the live chart (pressure, flow,
 * weight flow, weight ÷10, mix temp ÷10) with the same colours via the
 * shared `chartTraces.ts` module. Historical shot records don't carry
 * `target*` fields, so the mini omits the dashed targets the live chart
 * includes.
 */
export const ShotMiniChart: Component<{
  shot: Accessor<GatewayShotRecord | null>;
}> = (p) => {
  let container!: HTMLDivElement;
  let chart: uPlot | undefined;

  /**
   * Walk the measurements once and build a uPlot-shaped AlignedData with
   * the same five traces + transforms as the live chart. Skips frames
   * where the value is missing (rare; happens when scale was offline).
   */
  const buildData = (rec: GatewayShotRecord): uPlot.AlignedData => {
    if (!rec.measurements.length) return [[], [], [], [], [], []];
    const t0 = Date.parse(rec.measurements[0]!.machine.timestamp) / 1000;
    const ts: number[] = [];
    const pressure: number[] = [];
    const flow: number[] = [];
    const weight: number[] = [];
    const mix: number[] = [];
    const weightFlow: number[] = [];
    for (const m of rec.measurements) {
      ts.push(Date.parse(m.machine.timestamp) / 1000 - t0);
      pressure.push(TRACE_TRANSFORM.pressure(m.machine.pressure));
      flow.push(TRACE_TRANSFORM.flow(m.machine.flow));
      weight.push(
        m.scale ? TRACE_TRANSFORM.weight(m.scale.weight) : NaN,
      );
      mix.push(TRACE_TRANSFORM.mixTemperature(m.machine.mixTemperature));
      const wf = m.scale?.weightFlow;
      weightFlow.push(wf != null ? TRACE_TRANSFORM.weightFlow(wf) : NaN);
    }
    return [ts, pressure, flow, weight, mix, weightFlow];
  };

  onMount(() => {
    const opts: uPlot.Options = {
      width: container.clientWidth || 280,
      height: 100,
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, show: false },
      // pxAlign:0 matches the live chart — lets canvas AA engage on gentle
      // slopes (otherwise stroke coords floor to integer px and stair-step).
      pxAlign: 0,
      scales: {
        x: { time: false },
        y: { range: [0, 12] },
      },
      // No axes — the live chart's readouts row carries units; the mini's
      // job is just to render the shape of the shot.
      axes: [{ show: false }, { show: false }],
      series: [
        {},
        { stroke: TRACE_COLOR.pressure, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.flow, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.weight, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.mixTemperature, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.weightFlow, width: 1.5, points: { show: false } },
      ],
    };
    chart = new uPlot(opts, [[], [], [], [], [], []], container);

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart?.setSize({ width: entry.contentRect.width, height: 100 });
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
