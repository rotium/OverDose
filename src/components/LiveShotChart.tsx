import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  createEffect,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
} from 'solid-js';
import type { ProfileSnapshot } from '../api';
import type { LiveShotBuffers } from '../liveShot';
import {
  DEFAULT_CHART_SMOOTHING,
  DEFAULT_TRACE_VISIBILITY,
  type ChartSmoothing,
  type TraceVisibility,
} from '../prefs';
import { TRACE_COLOR, TRACE_TRANSFORM } from './chartTraces';

/**
 * Streaming uPlot chart for the live brew drawer. Hot path bypasses Solid
 * reactivity: a single createEffect tracks `frameCount`, then slices the
 * caller's typed-array buffers up to the current cursor and calls
 * `chart.setData()` once. Per-frame data never touches Solid signals.
 *
 * Single Y axis (~0–12, unitless). Per-trace transforms on the way in so
 * everything lands on one ruler:
 *
 *   pressure        raw     (bar, 0–~12)
 *   flow            raw     (mL/s, 0–~6)
 *   weight          ÷ 10    (g → 0–~5 for a 50 g shot)
 *   mixTemperature  ÷ 10    (°C → 8.0–9.5)
 *
 * Targets paint as dashed siblings using the same transforms. The readouts
 * row in LiveEspressoView carries the real units; the chart's y-axis is
 * purely a visual ruler.
 */
export interface LiveShotChartProps {
  buffers: LiveShotBuffers;
  frameCount: Accessor<number>;
  /** When provided, each step transition gets a label with the matching
   *  step's name from the profile. Null/undefined hides labels but still
   *  draws the vertical boundary lines. */
  profile?: Accessor<ProfileSnapshot | null>;
  /**
   * Line smoothing mode for the solid traces — see `ChartSmoothing` in
   * `src/prefs.ts`. Defaults to `DEFAULT_CHART_SMOOTHING` ('rounded'),
   * which softens corner pixels without modifying the data path.
   */
  smoothing?: ChartSmoothing;
  /**
   * Per-trace visibility. When provided and a flag flips, the matching
   * uPlot series is shown/hidden via `setSeries`. Defaults to
   * `DEFAULT_TRACE_VISIBILITY` (all visible).
   */
  visibility?: Accessor<TraceVisibility>;
}

const X_SCALE = 'x';
const Y_SCALE = 'y';

// Per-trace transforms — shared with ShotMiniChart via `chartTraces.ts`.
// Centralising keeps the live chart and the historical mini chart aligned
// on units and visual scale.
const transform = TRACE_TRANSFORM;

// Pre-allocated scratch arrays for the transformed slices we hand to uPlot.
// uPlot wants AlignedData = number[][] (regular arrays), so we still allocate
// shallow JS arrays per setData() — but only of length `cursor`, not the
// 6000-frame buffer capacity. This is the hottest realistic alloc; we keep
// the typed buffers themselves immutable.
const sliceArray = (src: Float64Array, n: number, f: (x: number) => number): number[] => {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = f(src[i]!);
  return out;
};

const sliceXSeconds = (src: Float64Array, n: number): number[] => {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = src[i]! / 1000;
  return out;
};

/**
 * Resolve effective per-series visibility from the user's preference set.
 * Extracted so we can unit-test the AND-logic that gates target lines on
 * both their primary AND the master `targets` flag — and so the chart's
 * effect stays a thin one-line-per-series translator.
 *
 * Returns one entry per uPlot series index (1-based; index 0 is the X
 * axis). Pure function — same input always yields same output, no side
 * effects.
 */
export const resolveSeriesVisibility = (
  v: TraceVisibility,
): Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, boolean> => ({
  1: v.pressure,
  2: v.flow,
  3: v.weight,
  4: v.mixTemp,
  5: v.weightFlow,
  // Target lines: shown only when BOTH the primary is shown AND the
  // master targets flag is on. If the user hides the targets master,
  // re-enabling a primary does NOT bring its target back.
  6: v.pressure && v.targets,
  7: v.flow && v.targets,
  8: v.mixTemp && v.targets,
});

/**
 * Walks the profileFrame buffer and draws a vertical line + step-name
 * label at every step transition. Lines are bright enough to read against
 * the dark background; labels paint just to the right of each line, near
 * the top of the plot area. If no profile is provided, the lines still
 * draw — they're just unlabelled.
 *
 * Runs in the uPlot `draw` hook (which fires after axes/grid but before
 * the series strokes paint). Order matters: we want the labels readable
 * over the traces, so we paint with extra brightness and let the traces
 * sit on top of the *line* but not the *label* (achieved by drawing the
 * label background opaque).
 */
export const drawStepBoundaries = (
  u: uPlot,
  buffers: LiveShotBuffers,
  profile: ProfileSnapshot | null,
): void => {
  const n = buffers.cursor;
  if (n < 2) return;
  const pf = buffers.profileFrame;
  const tMs = buffers.tMs;
  const ctx = u.ctx;
  // Extend the boundary line well past the plot area on both ends so it
  // visually reads as an intentional divider/border rather than a data
  // trace barely poking through the bounds. The bottom extension reaches
  // into the x-axis tick area — that anchors the boundary to the time
  // axis, which reinforces "this is a divider, not a series".
  const overshoot = 16;
  const top = u.bbox.top - overshoot;
  const bottom = u.bbox.top + u.bbox.height + overshoot;

  ctx.save();

  // Neutral chrome — white-ish, dashed. Deliberately decoupled from any
  // data-trace colour so the eye never mistakes a boundary line for a
  // series. Lines + labels share the same hue so they read as one piece
  // of annotation, not two competing things.
  const LINE = 'rgba(255, 255, 255, 0.5)';
  const LABEL_BG = 'rgba(20, 20, 20, 0.85)';
  const LABEL_FG = 'rgba(255, 255, 255, 0.95)';

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';

  for (let i = 1; i < n; i++) {
    if (pf[i] === pf[i - 1]) continue;

    const xVal = tMs[i]! / 1000;
    const xPos = Math.round(u.valToPos(xVal, X_SCALE, true)) + 0.5;

    // Line
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(xPos, top);
    ctx.lineTo(xPos, bottom);
    ctx.stroke();

    // Label — step name (when profile available)
    const stepName = profile?.steps?.[pf[i]!]?.name;
    if (stepName) {
      ctx.setLineDash([]);
      const padX = 4;
      const padY = 2;
      const labelW = ctx.measureText(stepName).width;
      const labelH = 13;
      const labelX = xPos + 4;
      const labelY = top + 4;

      // Clamp into the plot area so labels at the rightmost transitions
      // don't bleed off the canvas.
      const right = u.bbox.left + u.bbox.width;
      const finalX = Math.min(labelX, right - labelW - padX * 2 - 1);

      // Opaque pill behind the text so traces don't bleed through.
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(
        finalX - padX,
        labelY - padY,
        labelW + padX * 2,
        labelH + padY * 2,
      );

      ctx.fillStyle = LABEL_FG;
      ctx.textAlign = 'left';
      ctx.fillText(stepName, finalX, labelY);
    }
  }

  ctx.restore();
};

const buildOptions = (
  width: number,
  height: number,
  buffers: LiveShotBuffers,
  getProfile: () => ProfileSnapshot | null,
  smoothing: ChartSmoothing,
): uPlot.Options => {
  // For 'spline' we replace the path builder on each solid series. uPlot
  // ships a built-in cubic-spline path that draws a smooth curve through
  // every sample. Targets stay linear regardless — they're piecewise-
  // defined in the profile, and splining them would lie about the profile.
  const solidPaths =
    smoothing === 'spline' && uPlot.paths?.spline
      ? uPlot.paths.spline()
      : undefined;

  // 'rounded' (and 'spline' as a side benefit) sets the canvas line cap +
  // join to round, so trace corners render as small arcs rather than
  // mitered points. Applied via `drawClear` so it persists across each
  // frame — canvas state isn't reset by `clearRect`. Default canvas
  // values are butt/miter, which is what 'linear' falls back to.
  const useRoundJoins = smoothing !== 'linear';

  const solid = (stroke: string): uPlot.Series => ({
    stroke,
    width: 2,
    points: { show: false },
    scale: Y_SCALE,
    ...(solidPaths ? { paths: solidPaths } : {}),
  });

  return {
    width,
    height,
    legend: { show: false },
    cursor: { drag: { x: false, y: false }, show: false },
    // pxAlign:0 lets stroke coords land on sub-pixel positions so Canvas 2D
    // anti-aliasing actually engages on gentle slopes. The default (pxAlign
    // = 1) floors coords to integer pixels — good for crisp axis lines, but
    // it stair-steps any slope subtler than ~1px per data point. Brew data
    // is mostly slopes; we trade flat-line crispness for diagonal smoothness.
    pxAlign: 0,
    scales: {
      [X_SCALE]: { time: false },
      [Y_SCALE]: { range: [0, 12] },
    },
    axes: [
      {
        scale: X_SCALE,
        stroke: '#888',
        grid: { stroke: '#2a2a2a', width: 1 },
        ticks: { stroke: '#444', size: 4 },
      },
      {
        scale: Y_SCALE,
        stroke: '#888',
        grid: { stroke: '#2a2a2a', width: 1 },
        ticks: { stroke: '#444', size: 4 },
        size: 36,
      },
    ],
    hooks: {
      drawClear: useRoundJoins
        ? [
            (u) => {
              u.ctx.lineCap = 'round';
              u.ctx.lineJoin = 'round';
            },
          ]
        : undefined,
      draw: [(u) => drawStepBoundaries(u, buffers, getProfile())],
    },
    series: [
      {},
      // Solid traces.
      solid(TRACE_COLOR.pressure),
      solid(TRACE_COLOR.flow),
      solid(TRACE_COLOR.weight),
      solid(TRACE_COLOR.mixTemperature),
      solid(TRACE_COLOR.weightFlow),
      // Dashed targets — always linear (no spline). Step-defined paths.
      {
        stroke: TRACE_COLOR.pressure,
        width: 1,
        dash: [5, 4],
        points: { show: false },
        scale: Y_SCALE,
      },
      {
        stroke: TRACE_COLOR.flow,
        width: 1,
        dash: [5, 4],
        points: { show: false },
        scale: Y_SCALE,
      },
      {
        stroke: TRACE_COLOR.mixTemperature,
        width: 1,
        dash: [5, 4],
        points: { show: false },
        scale: Y_SCALE,
      },
    ],
  };
};

export const LiveShotChart: Component<LiveShotChartProps> = (p) => {
  let container!: HTMLDivElement;
  let chart: uPlot | undefined;

  onMount(() => {
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 320;
    // Empty initial dataset — one X channel + eight Y series:
    //   4 solid live + 1 solid weight-flow + 3 dashed targets
    //   (mix-temp's solid trace shares with its target; weight has no target).
    const empty: uPlot.AlignedData = [[], [], [], [], [], [], [], [], []];
    chart = new uPlot(
      buildOptions(
        w,
        h,
        p.buffers,
        () => p.profile?.() ?? null,
        p.smoothing ?? DEFAULT_CHART_SMOOTHING,
      ),
      empty,
      container,
    );

    // Reactive visibility — flips are driven by legend clicks in the
    // parent view. Effect fires once at mount (initial sync) and again on
    // every toggle. Series indices match the order in `buildOptions.series`:
    //   1 pressure · 2 flow · 3 weight · 4 mixTemp · 5 weightFlow
    //   6 targetPressure · 7 targetFlow · 8 targetMixTemp
    //
    // Target traces follow their primary AND the master `targets` flag:
    // hiding the primary takes its target with it (no use seeing a target
    // line without the live value to compare it to), and the master
    // switch hides all targets at once.
    createEffect(() => {
      const v = p.visibility?.() ?? DEFAULT_TRACE_VISIBILITY;
      const c = chart;
      if (!c) return;
      const shown = resolveSeriesVisibility(v);
      c.setSeries(1, { show: shown[1] });
      c.setSeries(2, { show: shown[2] });
      c.setSeries(3, { show: shown[3] });
      c.setSeries(4, { show: shown[4] });
      c.setSeries(5, { show: shown[5] });
      c.setSeries(6, { show: shown[6] });
      c.setSeries(7, { show: shown[7] });
      c.setSeries(8, { show: shown[8] });
    });

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart?.setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(container);

    onCleanup(() => {
      ro.disconnect();
      chart?.destroy();
    });
  });

  // Hot path. Tracking frameCount alone means Solid wakes us up exactly
  // once per appended frame; everything else runs as untracked reads.
  createEffect(() => {
    const n = p.frameCount();
    if (!chart || n === 0) return;
    const b = p.buffers;
    chart.setData([
      sliceXSeconds(b.tMs, n),
      sliceArray(b.pressure, n, transform.pressure),
      sliceArray(b.flow, n, transform.flow),
      sliceArray(b.weight, n, transform.weight),
      sliceArray(b.mixTemperature, n, transform.mixTemperature),
      sliceArray(b.weightFlow, n, transform.weightFlow),
      sliceArray(b.targetPressure, n, transform.pressure),
      sliceArray(b.targetFlow, n, transform.flow),
      sliceArray(b.targetMixTemperature, n, transform.mixTemperature),
    ]);
  });

  return <div ref={container} class="live-shot-chart" data-testid="live-shot-chart" />;
};
