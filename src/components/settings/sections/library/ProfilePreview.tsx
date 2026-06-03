import { For, Show, createMemo, type Component } from 'solid-js';
import type { ProfileRecord } from '../../../../api';
import {
  buildProfileCurve,
  type ProfileCurve,
} from '../../../../profile/curve';
import { ProfileCurveChart } from './ProfileCurveChart';

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

const fmtGrams = (n: number | undefined): string | null =>
  typeof n === 'number' && n > 0 ? `${n.toFixed(0)} g` : null;
const fmtMl = (n: number | undefined): string | null =>
  typeof n === 'number' && n > 0 ? `${n.toFixed(0)} mL` : null;
const fmtTemp = (n: number | undefined): string | null =>
  typeof n === 'number' && n > 0 ? `${n.toFixed(1)} °C` : null;
const fmtSec = (n: number): string =>
  n < 10 ? n.toFixed(1) : Math.round(n).toString();

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
          <div class="profile-preview__chart-wrap">
            <ProfileCurveChart
              curve={curve()}
              testId="profile-preview-chart"
            />
            <div class="profile-preview__chart-legend" aria-hidden="true">
              <span class="profile-preview__chart-swatch profile-preview__chart-swatch--pressure" />
              <span>pressure (bar)</span>
              <span class="profile-preview__chart-swatch profile-preview__chart-swatch--flow" />
              <span>flow (mL/s)</span>
              <span class="profile-preview__chart-swatch profile-preview__chart-swatch--temperature" />
              <span>temp (°C)</span>
            </div>
          </div>
        </Show>

        <div class="profile-preview__chips" data-testid="profile-preview-chips">
          {/* Beverage type leads as a category tag, styled distinctly from
              the measurement chips. Always shown (incl. "espresso") so the
              profile's kind is never ambiguous. */}
          <Show when={bevType()}>
            <span class="profile-row__chip profile-row__chip--beverage">
              {bevType()}
            </span>
          </Show>
          {/* Show weight and volume independently. Volume is the no-scale
              stop fallback, so it must stay visible even when a weight
              target is also set — hiding it masked which target actually
              governs a scaleless shot. */}
          <Show when={targetWeight()}>
            <span class="profile-row__chip">Weight {targetWeight()}</span>
          </Show>
          <Show when={targetVolume()}>
            <span class="profile-row__chip">Volume {targetVolume()}</span>
          </Show>
          <Show when={tankTemp()}>
            <span class="profile-row__chip">Tank preheat {tankTemp()}</span>
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

