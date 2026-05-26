import { For, Show, createMemo, type Component } from 'solid-js';
import type { ProfileRecord } from '../../../../api';
import {
  buildProfileCurve,
  type ProfileCurve,
  type SeriesPoint,
} from '../../../../profile/curve';
import { TRACE_COLOR, TRACE_TRANSFORM } from '../../../chartTraces';

/**
 * Detail pane for a single profile. Renders the title, metadata chips,
 * notes, the pressure / flow / temperature target curves as an SVG, and
 * a step list.
 *
 * SVG (not uPlot) is the right tool here — the data is static, the chart
 * is small, no zoom or interaction is needed, and skipping uPlot avoids
 * its DOM-mount + resize-observer overhead for what's a momentary preview
 * inside a dialog.
 *
 * Chart Y axis follows the live-chart convention from `chartTraces.ts`:
 * single 0–12 axis. Pressure and flow render at raw values; temperature
 * is divided by 10 so 92 °C lands at 9.2 on the axis. Real units live in
 * the legend so the user reads °C, bar, mL/s and never the compressed
 * value.
 */
export interface ProfilePreviewProps {
  /** When null/undefined, renders a placeholder. */
  record: ProfileRecord | null | undefined;
}

const CHART_W = 520;
const CHART_H = 200;
const PAD_LEFT = 32;
const PAD_RIGHT = 16;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
/** Single shared Y axis ceiling. Pressure tops out at 12 bar (DE1
 *  firmware ceiling); flow caps below; temperature ÷ 10 keeps °C in
 *  range (100 °C → 10.0). */
const Y_AXIS_MAX = 12;

const fmtGrams = (n: number | undefined): string | null =>
  typeof n === 'number' && n > 0 ? `${n.toFixed(0)} g` : null;
const fmtMl = (n: number | undefined): string | null =>
  typeof n === 'number' && n > 0 ? `${n.toFixed(0)} mL` : null;
const fmtTemp = (n: number | undefined): string | null =>
  typeof n === 'number' && n > 0 ? `${n.toFixed(1)} °C` : null;
const fmtSec = (n: number): string =>
  n < 10 ? n.toFixed(1) : Math.round(n).toString();

const projectX = (t: number, durationSec: number): number => {
  if (durationSec <= 0) return PAD_LEFT;
  return PAD_LEFT + (t / durationSec) * (CHART_W - PAD_LEFT - PAD_RIGHT);
};
const projectY = (v: number): number => {
  return CHART_H - PAD_BOTTOM - (v / Y_AXIS_MAX) * (CHART_H - PAD_TOP - PAD_BOTTOM);
};

/** Project a series-of-(t,v) onto chart pixels, with per-trace transform
 *  (pressure / flow raw, temperature ÷ 10). */
const runToPoints = (
  run: SeriesPoint[],
  durationSec: number,
  transform: (v: number) => number,
): string =>
  run
    .map((p) => `${projectX(p.t, durationSec)},${projectY(transform(p.v))}`)
    .join(' ');

export const ProfilePreview: Component<ProfilePreviewProps> = (p) => {
  const record = (): ProfileRecord | null => p.record ?? null;
  const profile = () => record()?.profile;
  const curve = createMemo<ProfileCurve>(() =>
    buildProfileCurve(profile()?.steps),
  );

  const title = (): string =>
    (profile()?.title ?? '').trim() || '(untitled)';
  const author = (): string => (profile()?.author ?? '').trim();
  const notes = (): string => (profile()?.notes ?? '').trim();
  const bevType = (): string =>
    (profile()?.beverage_type ?? '').trim();
  const targetWeight = () => fmtGrams(profile()?.target_weight);
  const targetVolume = () => fmtMl(profile()?.target_volume);
  const tankTemp = () => fmtTemp(profile()?.tank_temperature);

  return (
    <div class="profile-preview" data-testid="profile-preview">
      <Show
        when={record()}
        fallback={
          <p
            class="profile-preview__placeholder"
            data-testid="profile-preview-empty"
          >
            Select a profile to preview.
          </p>
        }
      >
        <header class="profile-preview__header">
          <div class="profile-preview__title-row">
            <h3 class="profile-preview__title">{title()}</h3>
            <Show when={record()!.isDefault}>
              <span
                class="profile-row__badge profile-row__badge--default"
                data-testid="profile-preview-default-badge"
              >
                default
              </span>
            </Show>
          </div>
          <Show when={author()}>
            <p class="profile-preview__author">by {author()}</p>
          </Show>
        </header>

        <Show
          when={!curve().empty}
          fallback={
            <div
              class="profile-preview__no-curve"
              data-testid="profile-preview-no-curve"
            >
              No step data — this profile has no parseable pressure,
              flow, or temperature timeline.
            </div>
          }
        >
          <CurveSvg curve={curve()} />
        </Show>

        <div class="profile-preview__chips" data-testid="profile-preview-chips">
          <Show when={targetWeight()}>
            <span class="profile-row__chip">Target {targetWeight()}</span>
          </Show>
          <Show when={!targetWeight() && targetVolume()}>
            <span class="profile-row__chip">Target {targetVolume()}</span>
          </Show>
          <Show when={tankTemp()}>
            <span class="profile-row__chip">Tank {tankTemp()}</span>
          </Show>
          <Show
            when={bevType() && bevType().toLowerCase() !== 'espresso'}
          >
            <span class="profile-row__chip">{bevType()}</span>
          </Show>
        </div>

        <Show when={notes()}>
          <p
            class="profile-preview__notes"
            data-testid="profile-preview-notes"
          >
            {notes()}
          </p>
        </Show>

        <Show when={curve().stepLabels.length > 0}>
          <section class="profile-preview__steps">
            <h4 class="profile-preview__steps-title">Steps</h4>
            <ol class="profile-preview__step-list">
              <For each={curve().stepLabels}>
                {(s) => (
                  <li class="profile-preview__step">
                    <span class="profile-preview__step-name">
                      {s.name || '(unnamed)'}
                    </span>
                    <span class="profile-preview__step-time">
                      {fmtSec(s.endSec - s.startSec)} s
                    </span>
                  </li>
                )}
              </For>
            </ol>
          </section>
        </Show>
      </Show>
    </div>
  );
};

interface CurveSvgProps {
  curve: ProfileCurve;
}

const CurveSvg: Component<CurveSvgProps> = (p) => (
  <div class="profile-preview__chart-wrap">
    <svg
      class="profile-preview__chart"
      data-testid="profile-preview-chart"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label="Profile target curve"
    >
      {/* Plot area background */}
      <rect
        x={PAD_LEFT}
        y={PAD_TOP}
        width={CHART_W - PAD_LEFT - PAD_RIGHT}
        height={CHART_H - PAD_TOP - PAD_BOTTOM}
        class="profile-preview__chart-plot"
      />
      {/* Y-axis ticks — single 0–12 axis. The values are unitless because
          three traces share it (pressure bar, flow mL/s, temp ÷ 10 °C).
          Real units live in the legend so the user never reads a
          deceptive single-unit label off the chart. */}
      <For each={[0, 3, 6, 9, 12]}>
        {(v) => (
          <g>
            <line
              x1={PAD_LEFT}
              x2={CHART_W - PAD_RIGHT}
              y1={projectY(v)}
              y2={projectY(v)}
              class="profile-preview__chart-grid"
            />
            <text
              x={PAD_LEFT - 6}
              y={projectY(v)}
              text-anchor="end"
              dominant-baseline="middle"
              class="profile-preview__chart-tick"
            >
              {v}
            </text>
          </g>
        )}
      </For>
      {/* X-axis labels — 0 and duration */}
      <text
        x={PAD_LEFT}
        y={CHART_H - 6}
        text-anchor="start"
        class="profile-preview__chart-tick"
      >
        0
      </text>
      <text
        x={CHART_W - PAD_RIGHT}
        y={CHART_H - 6}
        text-anchor="end"
        class="profile-preview__chart-tick"
      >
        {Math.round(p.curve.durationSec)} s
      </text>
      {/* Trace order: temperature first (background-y), then flow, then
          pressure on top — matches the live chart's z-order intuition
          (pressure is the most-read trace). */}
      <For each={p.curve.temperatureRuns}>
        {(run) => (
          <polyline
            points={runToPoints(
              run,
              p.curve.durationSec,
              TRACE_TRANSFORM.mixTemperature,
            )}
            class="profile-preview__chart-line profile-preview__chart-line--temperature"
            stroke={TRACE_COLOR.mixTemperature}
            data-testid="profile-preview-chart-temperature-run"
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
            )}
            class="profile-preview__chart-line profile-preview__chart-line--flow"
            stroke={TRACE_COLOR.flow}
            data-testid="profile-preview-chart-flow-run"
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
            )}
            class="profile-preview__chart-line profile-preview__chart-line--pressure"
            stroke={TRACE_COLOR.pressure}
            data-testid="profile-preview-chart-pressure-run"
          />
        )}
      </For>
    </svg>
    <div class="profile-preview__chart-legend" aria-hidden="true">
      <span class="profile-preview__chart-swatch profile-preview__chart-swatch--pressure" />
      <span>pressure (bar)</span>
      <span class="profile-preview__chart-swatch profile-preview__chart-swatch--flow" />
      <span>flow (mL/s)</span>
      <span class="profile-preview__chart-swatch profile-preview__chart-swatch--temperature" />
      <span>temp (°C)</span>
    </div>
  </div>
);
