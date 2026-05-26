import { For, type Component } from 'solid-js';
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
  /** Optional explicit test-id root override. Defaults to "profile-curve-chart". */
  testId?: string;
}

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
      {/* X-axis labels (start + duration). Compact mode hides them. */}
      {!compact() && (
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
      )}
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
    </svg>
  );
};
