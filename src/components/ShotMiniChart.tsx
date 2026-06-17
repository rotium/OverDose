import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  createEffect,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
} from 'solid-js';
import type { GatewayShotRecord, ProfileSnapshot } from '../api';
import { DEFAULT_TRACE_VISIBILITY, type TraceKey, type TraceVisibility } from '../prefs';
import { TRACE_COLOR, TRACE_TRANSFORM } from './chartTraces';

export interface StepBoundary {
  /** Seconds from shot start where the profile step changed. */
  xSec: number;
  /** The step index entered at this boundary (indexes profile.steps). */
  frame: number;
}

/**
 * Step transitions of a recorded shot: the times where `machine.profileFrame`
 * changes, mirroring the live chart's vertical step-boundary lines. Pure;
 * exported for testing. Frames without a recorded index are skipped, so older
 * records (no per-sample frame) simply yield no boundaries.
 */
export const shotStepBoundaries = (rec: GatewayShotRecord): StepBoundary[] => {
  const ms = rec.measurements;
  if (!ms || ms.length < 2) return [];
  const t0 = Date.parse(ms[0]!.machine.timestamp) / 1000;
  const out: StepBoundary[] = [];
  let last: number | undefined;
  for (const m of ms) {
    const f = m.machine.profileFrame;
    if (f == null) continue;
    if (last != null && f !== last) {
      out.push({ xSec: Date.parse(m.machine.timestamp) / 1000 - t0, frame: f });
    }
    last = f;
  }
  return out;
};

/**
 * Draw the dashed vertical step-boundary lines (+ step-name labels) in a uPlot
 * `draw` hook — the frozen-shot counterpart to LiveShotChart.drawStepBoundaries.
 */
const drawShotStepBoundaries = (
  u: uPlot,
  boundaries: StepBoundary[],
  profile: ProfileSnapshot | null,
  withLabels: boolean,
): void => {
  if (!boundaries.length) return;
  const ctx = u.ctx;
  const overshoot = 16;
  const top = u.bbox.top - overshoot;
  const bottom = u.bbox.top + u.bbox.height + overshoot;
  const LINE = 'rgba(255, 255, 255, 0.5)';
  const LABEL_BG = 'rgba(20, 20, 20, 0.85)';
  const LABEL_FG = 'rgba(255, 255, 255, 0.95)';

  ctx.save();
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (const b of boundaries) {
    const xPos = Math.round(u.valToPos(b.xSec, 'x', true)) + 0.5;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(xPos, top);
    ctx.lineTo(xPos, bottom);
    ctx.stroke();

    const stepName = withLabels ? profile?.steps?.[b.frame]?.name : undefined;
    if (stepName) {
      ctx.setLineDash([]);
      const padX = 4;
      const padY = 2;
      const labelW = ctx.measureText(stepName).width;
      const labelH = 13;
      const right = u.bbox.left + u.bbox.width;
      const finalX = Math.min(xPos + 4, right - labelW - padX * 2 - 1);
      const labelY = top + 4;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(finalX - padX, labelY - padY, labelW + padX * 2, labelH + padY * 2);
      ctx.fillStyle = LABEL_FG;
      ctx.textAlign = 'left';
      ctx.fillText(stepName, finalX, labelY);
    }
  }
  ctx.restore();
};

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
  /** Draw the profile's vertical step-boundary lines (+ labels), like the
   *  live chart. Off by default (the compact Home preview skips them). */
  stepBoundaries?: boolean;
  /** Enable the interactive crosshair (full-mode review overlay only). Off by
   *  default, so the inline detail and Home preview stay static. */
  cursor?: boolean;
  /** Reports the hovered sample index (or null) as the crosshair scrubs.
   *  Pairs with `cursor` to drive a readout strip. */
  onHover?: (idx: number | null) => void;
  /** Render right-edge value flags that track the crosshair (full-mode only):
   *  each visible solid trace gets a colour-matched pill at its value's height
   *  plus an on-curve dot at the cursor. Requires `cursor`. */
  cursorFlags?: boolean;
}> = (p) => {
  let container!: HTMLDivElement;
  let chart: uPlot | undefined;
  // Current shot's step boundaries + profile, read by the uPlot draw hook.
  let stepBounds: StepBoundary[] = [];
  let stepProfile: ProfileSnapshot | null = null;
  let showSteps = true; // gated by the `steps` visibility flag

  // ─── Right-edge value flags (C3) ──────────────────────────────────────
  // Each solid series maps to its colour, unit and the INVERSE of its plot
  // transform — the pill sits at the compressed plotted value's height but
  // shows the real-unit number. Built imperatively (not via signals) and
  // updated straight from the cursor hook, matching this chart's hot-path
  // "bypass Solid reactivity" pattern.
  interface FlagSpec {
    series: number;
    visKey: TraceKey;
    color: string;
    unit: string;
    digits: number;
    toReal: (plotted: number) => number;
  }
  const FLAG_SPECS: FlagSpec[] = [
    { series: 1, visKey: 'pressure', color: TRACE_COLOR.pressure, unit: 'bar', digits: 1, toReal: (n) => n },
    { series: 2, visKey: 'flow', color: TRACE_COLOR.flow, unit: 'mL/s', digits: 1, toReal: (n) => n },
    { series: 3, visKey: 'weight', color: TRACE_COLOR.weight, unit: 'g', digits: 1, toReal: (n) => n * 10 },
    { series: 4, visKey: 'mixTemp', color: TRACE_COLOR.mixTemperature, unit: '°C', digits: 0, toReal: (n) => n * 10 },
    { series: 5, visKey: 'weightFlow', color: TRACE_COLOR.weightFlow, unit: 'g/s', digits: 1, toReal: (n) => n },
  ];
  const SVG_NS = 'http://www.w3.org/2000/svg' as const;
  const flagEls = new Map<
    number,
    { pill: HTMLDivElement; num: HTMLSpanElement; dot: HTMLDivElement; line: SVGLineElement }
  >();
  let lastFlagIdx: number | null = null;
  // Which side of the cursor the value column rides on. Sticky (hysteresis) so
  // it doesn't flip-flop while scrubbing past the threshold near the edge.
  let flagSide: 'left' | 'right' = 'right';
  const FLAG_OFFSET = 26; // px gap from cursor to the column's near edge
  const FLAG_RESERVE = 104; // room a side needs before the column flips
  const FLAG_HYSTERESIS = 28;
  const FLAG_GAP = 22; // min vertical spacing between de-collided pills

  const buildFlags = (): void => {
    const layer = document.createElement('div');
    layer.className = 'chart-flags';
    // Leader lines share one SVG, added first so the pills/dots paint above.
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'chart-flags__leaders');
    layer.append(svg);
    for (const spec of FLAG_SPECS) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'chart-flag__leader');
      line.setAttribute('stroke', spec.color);
      line.style.display = 'none';
      svg.append(line);

      const pill = document.createElement('div');
      pill.className = 'chart-flag';
      pill.style.setProperty('--flag-color', spec.color);
      pill.style.display = 'none';
      const num = document.createElement('span');
      num.className = 'chart-flag__num';
      const unit = document.createElement('span');
      unit.className = 'chart-flag__unit';
      unit.textContent = spec.unit;
      pill.append(num, unit);

      const dot = document.createElement('div');
      dot.className = 'chart-flag__dot';
      dot.style.setProperty('--flag-color', spec.color);
      dot.style.display = 'none';

      layer.append(dot, pill);
      flagEls.set(spec.series, { pill, num, dot, line });
    }
    container.style.position = 'relative';
    container.append(layer);
  };

  const hideAllFlags = (): void => {
    for (const { pill, dot, line } of flagEls.values()) {
      pill.style.display = 'none';
      dot.style.display = 'none';
      line.style.display = 'none';
    }
  };

  const updateFlags = (idx: number | null): void => {
    lastFlagIdx = idx;
    const u = chart;
    if (!u || !flagEls.size) return;
    const t = u.data[0]?.[idx ?? -1];
    if (idx == null || t == null) {
      hideAllFlags();
      return;
    }
    const v = p.visibility?.() ?? DEFAULT_TRACE_VISIBILITY;
    const over = u.over;
    const plotLeft = over.offsetLeft;
    const plotTop = over.offsetTop;
    const plotW = over.offsetWidth;
    const cursorX = plotLeft + u.valToPos(t, 'x');

    // Park the column on the side of the cursor with room; stay there until the
    // other side is clearly better, so it doesn't flip-flop mid-scrub.
    const roomRight = plotLeft + plotW - cursorX;
    if (flagSide === 'right' && roomRight < FLAG_RESERVE) flagSide = 'left';
    else if (flagSide === 'left' && roomRight > FLAG_RESERVE + FLAG_HYSTERESIS) flagSide = 'right';
    const nearX = flagSide === 'right' ? cursorX + FLAG_OFFSET : cursorX - FLAG_OFFSET;

    // Collect the visible, finite traces; the rest hide.
    const active: Array<{ spec: FlagSpec; curveY: number; flagY: number; real: number }> = [];
    for (const spec of FLAG_SPECS) {
      const els = flagEls.get(spec.series)!;
      const plotted = u.data[spec.series]?.[idx];
      if (!v[spec.visKey] || plotted == null || !Number.isFinite(plotted)) {
        els.pill.style.display = 'none';
        els.dot.style.display = 'none';
        els.line.style.display = 'none';
        continue;
      }
      const curveY = plotTop + u.valToPos(plotted, 'y');
      active.push({ spec, curveY, flagY: curveY, real: spec.toReal(plotted) });
    }
    // Vertical de-collision: walk top→bottom, push overlapping pills down.
    active.sort((a, b) => a.curveY - b.curveY);
    let prev = -Infinity;
    for (const a of active) {
      if (a.flagY < prev + FLAG_GAP) a.flagY = prev + FLAG_GAP;
      prev = a.flagY;
    }
    for (const a of active) {
      const els = flagEls.get(a.spec.series)!;
      els.num.textContent = a.real.toFixed(a.spec.digits);
      els.pill.style.display = '';
      els.pill.style.left = `${nearX}px`;
      els.pill.style.top = `${a.flagY}px`;
      els.pill.style.transform =
        flagSide === 'right' ? 'translateY(-50%)' : 'translate(-100%, -50%)';
      els.dot.style.display = '';
      els.dot.style.left = `${cursorX}px`;
      els.dot.style.top = `${a.curveY}px`;
      // Faded leader from the on-curve dot to the offset pill's near edge.
      els.line.style.display = '';
      els.line.setAttribute('x1', `${cursorX}`);
      els.line.setAttribute('y1', `${a.curveY}`);
      els.line.setAttribute('x2', `${nearX}`);
      els.line.setAttribute('y2', `${a.flagY}`);
    }
  };
  // Resolve the height uPlot should draw at: the container's measured
  // height when filling, else the fixed prop.
  const chartHeight = (): number =>
    p.fill ? container.clientHeight || 240 : (p.height ?? 100);

  onMount(() => {
    // Cursor-move subscribers: report the hovered index out, and/or refresh
    // the on-chart value flags. Combined into one hook array so both fire.
    const setCursorHooks: Array<(u: uPlot) => void> = [];
    if (p.onHover) setCursorHooks.push((u) => p.onHover!(u.cursor.idx ?? null));
    if (p.cursorFlags) setCursorHooks.push((u) => updateFlags(u.cursor.idx ?? null));

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
      // Crosshair only in full-mode (opt-in); never a drag-zoom. Static
      // otherwise, exactly as the inline/preview charts have always been.
      cursor: p.cursor
        ? { show: true, x: true, y: false, drag: { x: false, y: false } }
        : { show: false, drag: { x: false, y: false } },
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
      hooks: {
        ...(p.stepBoundaries
          ? {
              draw: [
                (u: uPlot) => {
                  if (showSteps) {
                    // Labels only on the larger (axed) charts; the compact
                    // Home preview shows just the lines.
                    drawShotStepBoundaries(
                      u,
                      stepBounds,
                      stepProfile,
                      p.showAxes ?? false,
                    );
                  }
                },
              ],
            }
          : {}),
        ...(setCursorHooks.length ? { setCursor: setCursorHooks } : {}),
      },
    };
    chart = new uPlot(opts, [[], [], [], [], [], [], [], [], []], container);

    if (p.cursorFlags) buildFlags();

    // Touch fix: uPlot tracks the cursor off `mousemove`, which a touch drag
    // never fires — so the crosshair "triggers but doesn't follow" on the
    // tablet. Bridge pointer events (touch/pen) into uPlot's cursor, with
    // `touch-action: none` so the browser doesn't steal the drag as a scroll,
    // and pointer capture so a finger that drifts keeps scrubbing. Mouse is
    // left to uPlot's own handling.
    if (p.cursor) {
      const over = chart.over;
      over.style.touchAction = 'none';
      const moveCursor = (e: PointerEvent): void => {
        if (e.pointerType === 'mouse') return;
        const rect = over.getBoundingClientRect();
        chart?.setCursor({ left: e.clientX - rect.left, top: e.clientY - rect.top });
      };
      const onDown = (e: PointerEvent): void => {
        if (e.pointerType === 'mouse') return;
        over.setPointerCapture?.(e.pointerId);
        moveCursor(e);
      };
      over.addEventListener('pointerdown', onDown);
      over.addEventListener('pointermove', moveCursor);
      onCleanup(() => {
        over.removeEventListener('pointerdown', onDown);
        over.removeEventListener('pointermove', moveCursor);
      });
    }

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
    if (p.stepBoundaries) {
      stepBounds = shotStepBoundaries(rec);
      stepProfile = rec.workflow?.profile ?? null;
    }
    chart.setData(buildShotChartData(rec));
  });

  // Apply per-trace visibility (legend show/hide) — same setSeries
  // mechanism the live chart uses. setSeries triggers a redraw, which re-runs
  // the step-boundary draw hook, so toggling `steps` reflects immediately.
  createEffect(() => {
    const v = p.visibility?.();
    if (!chart || !v) return;
    showSteps = v.steps ?? true;
    const show = seriesShow(v);
    for (const idx of Object.keys(show)) {
      chart.setSeries(Number(idx), { show: show[Number(idx)] });
    }
    // Re-evaluate flags at the parked cursor so a just-hidden trace drops its
    // flag (and a re-shown one returns) without needing a fresh pointer move.
    if (p.cursorFlags) updateFlags(lastFlagIdx);
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
