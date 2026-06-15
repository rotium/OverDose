import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  createEffect,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
} from 'solid-js';
import type { GatewayShotRecord } from '../api';
import type { TraceVisibility } from '../prefs';
import { TRACE_COLOR, TRACE_TRANSFORM } from './chartTraces';

/**
 * Frozen-trace chart for a completed shot. Unlike `LiveShotChart` (which
 * streams), this is one-shot: when a shot record arrives, build the data
 * arrays, set them once, and never push again.
 *
 * Renders the same five solid traces as the live chart (pressure, flow,
 * weight flow, weight ÷10, mix temp ÷10) with the same colours via the
 * shared `chartTraces.ts` module, plus the dashed target overlays
 * (target pressure/flow/mix-temp) when the record carries the per-sample
 * setpoints — older records that don't simply render no dashed lines.
 *
 * Size + chrome are configurable: LastShotCard uses the compact default
 * (100px, no axes); the post-brew result screen renders it taller with
 * axes and drives per-trace `visibility` from its own clickable legend
 * (same show/hide UX as the live view). The legend itself lives in the
 * consumer — this component only applies the visibility to the series.
 */

// Which TraceVisibility flags gate each uPlot series index (1-based; 0 is x).
// Dashed targets (6-8) show only when their primary AND the `targets` master
// are on — mirrors the live chart's resolveSeriesVisibility.
export const seriesShow = (
  v: TraceVisibility,
): Record<number, boolean> => ({
  1: v.pressure,
  2: v.flow,
  3: v.weight,
  4: v.mixTemp,
  5: v.weightFlow,
  6: v.pressure && v.targets,
  7: v.flow && v.targets,
  8: v.mixTemp && v.targets,
});

// Missing setpoints (older records) → NaN so uPlot draws a gap, not a
// misleading flat line at 0.
const target = (n: number | undefined, f: (x: number) => number): number =>
  n == null ? NaN : f(n);

/**
 * Walk a record's measurements once into uPlot-shaped AlignedData: 9 arrays —
 * time, the five solid traces, then the three dashed setpoint overlays. Pure;
 * exported for testing.
 */
export const buildShotChartData = (
  rec: GatewayShotRecord,
): uPlot.AlignedData => {
  if (!rec.measurements.length) {
    return [[], [], [], [], [], [], [], [], []];
  }
  const t0 = Date.parse(rec.measurements[0]!.machine.timestamp) / 1000;
  const ts: number[] = [];
  const pressure: number[] = [];
  const flow: number[] = [];
  const weight: number[] = [];
  const mix: number[] = [];
  const weightFlow: number[] = [];
  const tPressure: number[] = [];
  const tFlow: number[] = [];
  const tMix: number[] = [];
  for (const m of rec.measurements) {
    ts.push(Date.parse(m.machine.timestamp) / 1000 - t0);
    pressure.push(TRACE_TRANSFORM.pressure(m.machine.pressure));
    flow.push(TRACE_TRANSFORM.flow(m.machine.flow));
    weight.push(m.scale ? TRACE_TRANSFORM.weight(m.scale.weight) : NaN);
    mix.push(TRACE_TRANSFORM.mixTemperature(m.machine.mixTemperature));
    const wf = m.scale?.weightFlow;
    weightFlow.push(wf != null ? TRACE_TRANSFORM.weightFlow(wf) : NaN);
    tPressure.push(target(m.machine.targetPressure, TRACE_TRANSFORM.pressure));
    tFlow.push(target(m.machine.targetFlow, TRACE_TRANSFORM.flow));
    tMix.push(target(m.machine.targetMixTemperature, TRACE_TRANSFORM.mixTemperature));
  }
  return [ts, pressure, flow, weight, mix, weightFlow, tPressure, tFlow, tMix];
};

export const ShotMiniChart: Component<{
  shot: Accessor<GatewayShotRecord | null>;
  /** Chart height in px. Default 100 (compact). Ignored when `fill`. */
  height?: number;
  /** Fill the parent's height (flex chart area) instead of a fixed
   *  height — the post-brew screen uses this so the chart grows like the
   *  live chart. The container must have a real height (flex:1). */
  fill?: boolean;
  /** Render time (x) + compressed-value (y) axes. Default false. */
  showAxes?: boolean;
  /** Per-trace show/hide. Driven by the consumer's legend. When omitted,
   *  all traces show. */
  visibility?: Accessor<TraceVisibility>;
}> = (p) => {
  let container!: HTMLDivElement;
  let chart: uPlot | undefined;
  // Resolve the height uPlot should draw at: the container's measured
  // height when filling, else the fixed prop.
  const chartHeight = (): number =>
    p.fill ? container.clientHeight || 240 : (p.height ?? 100);

  onMount(() => {
    const axisStroke = '#9aa0aa';
    const gridStroke = 'rgba(255, 255, 255, 0.07)';
    const axis = (label?: string): uPlot.Axis => ({
      show: true,
      stroke: axisStroke,
      grid: { stroke: gridStroke, width: 1 },
      ticks: { stroke: gridStroke, width: 1 },
      font: '11px system-ui, sans-serif',
      ...(label ? { label, labelFont: '11px system-ui, sans-serif' } : {}),
      size: 34,
    });
    const opts: uPlot.Options = {
      width: container.clientWidth || 280,
      height: chartHeight(),
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, show: false },
      // pxAlign:0 matches the live chart — lets canvas AA engage on gentle
      // slopes (otherwise stroke coords floor to integer px and stair-step).
      pxAlign: 0,
      scales: {
        x: { time: false },
        y: { range: [0, 12] },
      },
      axes: p.showAxes
        ? [axis('seconds'), axis()]
        : [{ show: false }, { show: false }],
      series: [
        {},
        { stroke: TRACE_COLOR.pressure, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.flow, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.weight, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.mixTemperature, width: 1.5, points: { show: false } },
        { stroke: TRACE_COLOR.weightFlow, width: 1.5, points: { show: false } },
        // Dashed setpoint overlays — same colour as their primary trace.
        { stroke: TRACE_COLOR.pressure, width: 1, dash: [5, 4], points: { show: false } },
        { stroke: TRACE_COLOR.flow, width: 1, dash: [5, 4], points: { show: false } },
        { stroke: TRACE_COLOR.mixTemperature, width: 1, dash: [5, 4], points: { show: false } },
      ],
    };
    chart = new uPlot(opts, [[], [], [], [], [], [], [], [], []], container);

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart?.setSize({
        width: entry.contentRect.width,
        height: p.fill ? entry.contentRect.height : (p.height ?? 100),
      });
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
    chart.setData(buildShotChartData(rec));
  });

  // Apply per-trace visibility (legend show/hide) — same setSeries
  // mechanism the live chart uses.
  createEffect(() => {
    const v = p.visibility?.();
    if (!chart || !v) return;
    const show = seriesShow(v);
    for (const idx of Object.keys(show)) {
      chart.setSeries(Number(idx), { show: show[Number(idx)] });
    }
  });

  return (
    <div
      ref={container}
      class="mini-chart"
      classList={{ 'mini-chart--fill': p.fill }}
      data-testid="shot-mini-chart"
    />
  );
};
