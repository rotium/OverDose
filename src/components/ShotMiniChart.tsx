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
 * shared `chartTraces.ts` module. Historical shot records don't carry
 * `target*` fields, so the chart omits the dashed targets the live chart
 * includes.
 *
 * Size + chrome are configurable: LastShotCard uses the compact default
 * (100px, no axes); the post-brew result screen renders it taller with
 * axes and drives per-trace `visibility` from its own clickable legend
 * (same show/hide UX as the live view). The legend itself lives in the
 * consumer — this component only applies the visibility to the series.
 */
const SERIES: { idx: number; key: keyof TraceVisibility }[] = [
  { idx: 1, key: 'pressure' },
  { idx: 2, key: 'flow' },
  { idx: 3, key: 'weight' },
  { idx: 4, key: 'mixTemp' },
  { idx: 5, key: 'weightFlow' },
];

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
      ],
    };
    chart = new uPlot(opts, [[], [], [], [], [], []], container);

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
    chart.setData(buildData(rec));
  });

  // Apply per-trace visibility (legend show/hide) — same setSeries
  // mechanism the live chart uses.
  createEffect(() => {
    const v = p.visibility?.();
    if (!chart || !v) return;
    for (const s of SERIES) chart.setSeries(s.idx, { show: v[s.key] });
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
