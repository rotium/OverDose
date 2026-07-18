import { For, Show, type Component } from 'solid-js';
import type { ProfileCurve, SeriesPoint } from '../../../../profile/curve';
import { TRACE_COLOR, TRACE_TRANSFORM } from '../../../chartTraces';

/**
 * Reusable target-curve SVG. Used by:
 *
 *   - `ProfilePreview` (right pane of the picker) — full-size chart.
 *   - `RecipeBrewScreen.BrewPrep` — compact thumbnail above dose/grinder
 *     stats so the user remembers what they're about to brew.
 *
 * Single 0–12 Y axis matching the live-chart convention from
 * `chartTraces.ts`: pressure and flow at raw values, temperature ÷ 10.
 * Real units live in the legend (caller-provided or omitted).
 *
 * Caller picks the size — the chart is responsive within whatever
 * container it's placed in. Padding scales with width to keep the plot
 * area sensible at small sizes. Tick labels are suppressed in compact
 * mode (width < 360) to avoid visual crowding.
 */
export interface ProfileCurveChartProps {
  curve: ProfileCurve;
  /** SVG viewBox width. Default 520. */
  width?: number;
  /** SVG viewBox height. Default 200. */
  height?: number;
  /** Hide tick labels + duration label (for very small thumbnails). */
  compact?: boolean;
  /**
   * Draw the profile's step boundaries. Full size: dashed dividers + a name
   * chip per step, and per-boundary times replacing the plain end labels on
   * the x-axis. Compact: dividers only (chips/times are unreadable that
   * small). Default true. Off → no step markers at all.
   */
  showSteps?: boolean;
  /** Draw step-name chips (full size only). Default true. No effect when
   *  `showSteps` is false or `compact` is true (thumbnails never label). */
  showStepNames?: boolean;
  /** Optional explicit test-id root override. Defaults to "profile-curve-chart". */
  testId?: string;
}

/** Approx px per character for the bold 11px chip font — used to size the
 *  chip background and clamp it inside the plot. Estimate; exactness isn't
 *  needed since the chip only frames the text. */
const CHIP_CHAR_PX = 6.3;
const CHIP_PAD_X = 4;
/** Minimum clear gap (viewBox px) between two adjacent chips before the later
 *  one is dropped. */
const CHIP_GAP = 3;
/** Approx px per character for the 10px x-axis tick font, and the minimum
 *  clear gap between two time labels. Both are estimates — collision handling
 *  works off each label's projected extent, so exactness isn't needed. */
const TICK_CHAR_PX = 5.6;
const TICK_GAP = 5;

const Y_AXIS_MAX = 12;

const projectX = (
  t: number,
  durationSec: number,
  width: number,
  padLeft: number,
  padRight: number,
): number => {
  if (durationSec <= 0) return padLeft;
  return padLeft + (t / durationSec) * (width - padLeft - padRight);
};

const projectY = (
  v: number,
  height: number,
  padTop: number,
  padBottom: number,
): number => {
  return height - padBottom - (v / Y_AXIS_MAX) * (height - padTop - padBottom);
};

const runToPoints = (
  run: SeriesPoint[],
  durationSec: number,
  transform: (v: number) => number,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  padTop: number,
  padBottom: number,
): string =>
  run
    .map(
      (p) =>
        `${projectX(p.t, durationSec, width, padLeft, padRight)},${projectY(
          transform(p.v),
          height,
          padTop,
          padBottom,
        )}`,
    )
    .join(' ');

export const ProfileCurveChart: Component<ProfileCurveChartProps> = (p) => {
  const width = (): number => p.width ?? 520;
  const height = (): number => p.height ?? 200;
  const compact = (): boolean => p.compact ?? width() < 360;
  // Smaller chart → less padding (proportional). Compact mode also drops
  // the tick-label gutter on the left since there are no ticks rendered.
  const padLeft = (): number => (compact() ? 6 : 32);
  const padRight = (): number => (compact() ? 6 : 16);
  const padTop = (): number => (compact() ? 4 : 12);
  const padBottom = (): number => (compact() ? 4 : 28);
  const testId = (): string => p.testId ?? 'profile-curve-chart';

  const showSteps = (): boolean => p.showSteps ?? true;
  const showStepNames = (): boolean => p.showStepNames ?? true;
  const px = (t: number): number =>
    projectX(t, p.curve.durationSec, width(), padLeft(), padRight());

  // Internal step boundaries (dashed dividers): the start of every step after
  // the first. The first step starts at the left edge and the last ends at the
  // right edge — both coincide with the plot frame, so they're not drawn.
  const boundaries = (): number[] =>
    p.curve.stepLabels.slice(1).map((s) => s.startSec);

  // X-axis time labels at every step edge (0, each boundary, duration),
  // replacing the plain 0 / duration labels. The first (0, left-anchored) and
  // last (duration, right-anchored) always draw; a middle label is dropped if
  // its projected text extent would collide with the previously-kept label or
  // with the duration label. Extents account for each label's width and anchor
  // so numbers never overlap regardless of how close the boundaries sit.
  const timeLabels = (): {
    x: number;
    anchor: 'start' | 'middle' | 'end';
    text: string;
  }[] => {
    const labels = p.curve.stepLabels;
    if (labels.length === 0) return [];
    const edges = [0, ...labels.map((s) => s.endSec)];
    const n = edges.length;
    const items = edges.map((t, i) => {
      const anchor: 'start' | 'middle' | 'end' =
        i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      const text = i === n - 1 ? `${Math.round(t)} s` : `${Math.round(t)}`;
      const x = px(t);
      const w = text.length * TICK_CHAR_PX;
      const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      const right = anchor === 'start' ? x + w : anchor === 'end' ? x : x + w / 2;
      return { x, anchor, text, left, right };
    });
    const last = items[n - 1]!;
    const kept = [items[0]!];
    let prevRight = items[0]!.right;
    for (let i = 1; i < n - 1; i++) {
      const it = items[i]!;
      if (it.left - prevRight < TICK_GAP) continue; // collides with previous
      if (last.left - it.right < TICK_GAP) continue; // collides with duration
      kept.push(it);
      prevRight = it.right;
    }
    if (n > 1) kept.push(last);
    return kept.map(({ x, anchor, text }) => ({ x, anchor, text }));
  };

  // Step name chips at each step's start, clamped inside the plot. A chip is
  // dropped if it would overlap the previously-kept one (the divider still
  // marks the boundary; the name lives in the list below the chart too).
  const stepChips = (): { x: number; w: number; label: string }[] => {
    const out: { x: number; w: number; label: string }[] = [];
    let prevRight = -Infinity;
    for (const s of p.curve.stepLabels) {
      const label = s.name || '(unnamed)';
      const w = label.length * CHIP_CHAR_PX + CHIP_PAD_X * 2;
      const rawX = px(s.startSec) + 3;
      const x = Math.min(rawX, width() - padRight() - w - 1);
      if (x - prevRight < CHIP_GAP) continue;
      prevRight = x + w;
      out.push({ x, w, label });
    }
    return out;
  };

  return (
    <svg
      class="profile-curve-chart"
      data-testid={testId()}
      data-compact={compact() || undefined}
      viewBox={`0 0 ${width()} ${height()}`}
      role="img"
      aria-label="Profile target curve"
    >
      <rect
        x={padLeft()}
        y={padTop()}
        width={width() - padLeft() - padRight()}
        height={height() - padTop() - padBottom()}
        class="profile-curve-chart__plot"
      />
      {/* Y-axis ticks — single 0–12 axis. Hidden in compact mode. */}
      <For each={compact() ? [] : [0, 3, 6, 9, 12]}>
        {(v) => (
          <g>
            <line
              x1={padLeft()}
              x2={width() - padRight()}
              y1={projectY(v, height(), padTop(), padBottom())}
              y2={projectY(v, height(), padTop(), padBottom())}
              class="profile-curve-chart__grid"
            />
            <text
              x={padLeft() - 6}
              y={projectY(v, height(), padTop(), padBottom())}
              text-anchor="end"
              dominant-baseline="middle"
              class="profile-curve-chart__tick"
            >
              {v}
            </text>
          </g>
        )}
      </For>
      {/* X-axis labels. Compact mode hides them. With steps on, label every
          step edge (0 · boundaries · duration) so the axis reads as the step
          timeline; otherwise just the two ends. */}
      {!compact() &&
        (showSteps() && p.curve.stepLabels.length > 0 ? (
          <For each={timeLabels()}>
            {(t) => (
              <text
                x={t.x}
                y={height() - 6}
                text-anchor={t.anchor}
                class="profile-curve-chart__tick"
                data-testid={`${testId()}-step-time`}
              >
                {t.text}
              </text>
            )}
          </For>
        ) : (
          <>
            <text
              x={padLeft()}
              y={height() - 6}
              text-anchor="start"
              class="profile-curve-chart__tick"
            >
              0
            </text>
            <text
              x={width() - padRight()}
              y={height() - 6}
              text-anchor="end"
              class="profile-curve-chart__tick"
            >
              {Math.round(p.curve.durationSec)} s
            </text>
          </>
        ))}
      {/* Step dividers — dashed verticals at internal boundaries, under the
          traces. Drawn in both full and compact modes. */}
      <Show when={showSteps()}>
        <For each={boundaries()}>
          {(t) => (
            <line
              x1={px(t)}
              x2={px(t)}
              y1={padTop()}
              y2={height() - padBottom()}
              class="profile-curve-chart__step-line"
              data-testid={`${testId()}-step-line`}
            />
          )}
        </For>
      </Show>
      {/* Trace z-order: temperature → flow → pressure on top. Matches
          the live shot chart's emphasis. */}
      <For each={p.curve.temperatureRuns}>
        {(run) => (
          <polyline
            points={runToPoints(
              run,
              p.curve.durationSec,
              TRACE_TRANSFORM.mixTemperature,
              width(),
              height(),
              padLeft(),
              padRight(),
              padTop(),
              padBottom(),
            )}
            class="profile-curve-chart__line profile-curve-chart__line--temperature"
            stroke={TRACE_COLOR.mixTemperature}
            data-testid={`${testId()}-temperature-run`}
          />
        )}
      </For>
      <For each={p.curve.flowRuns}>
        {(run) => (
          <polyline
            points={runToPoints(
              run,
              p.curve.durationSec,
              TRACE_TRANSFORM.flow,
              width(),
              height(),
              padLeft(),
              padRight(),
              padTop(),
              padBottom(),
            )}
            class="profile-curve-chart__line profile-curve-chart__line--flow"
            stroke={TRACE_COLOR.flow}
            data-testid={`${testId()}-flow-run`}
          />
        )}
      </For>
      <For each={p.curve.pressureRuns}>
        {(run) => (
          <polyline
            points={runToPoints(
              run,
              p.curve.durationSec,
              TRACE_TRANSFORM.pressure,
              width(),
              height(),
              padLeft(),
              padRight(),
              padTop(),
              padBottom(),
            )}
            class="profile-curve-chart__line profile-curve-chart__line--pressure"
            stroke={TRACE_COLOR.pressure}
            data-testid={`${testId()}-pressure-run`}
          />
        )}
      </For>
      {/* Step name chips — over the traces, at each step's start. Full size
          only; the compact thumbnail shows dividers without labels. Ghost
          style (no "active" step in a static profile). */}
      <Show when={showSteps() && !compact() && showStepNames()}>
        <For each={stepChips()}>
          {(chip) => (
            <>
              <rect
                x={chip.x}
                y={padTop() + 3}
                width={chip.w}
                height={15}
                rx={4}
                class="profile-curve-chart__step-chip-bg"
              />
              <text
                x={chip.x + CHIP_PAD_X}
                y={padTop() + 14}
                class="profile-curve-chart__step-chip"
                data-testid={`${testId()}-step-chip`}
              >
                {chip.label}
              </text>
            </>
          )}
        </For>
      </Show>
    </svg>
  );
};
