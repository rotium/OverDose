import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import type { ProfileSnapshot } from '../../api';
import type { LiveShotAccumulator, LiveShotReadouts } from '../../liveShot';
import {
  type TraceKey,
  type TraceVisibility,
} from '../../prefs';
import { useUserPrefs } from '../../UserPrefsContext';
import type { MachineSubstate } from '../../snapshot';
import { TRACE_COLOR } from '../chartTraces';
import { ClockIcon, ScaleIcon } from '../icons';
import { LiveShotChart } from '../LiveShotChart';

/**
 * Drawer body for an espresso brew. Composes:
 *
 *   - header   : profile name (primary) · operation + current state + step (secondary) · elapsed time
 *   - legend   : colored swatches mapping chart traces to names
 *   - chart    : LiveShotChart streaming pressure/flow/weight/mix-temp + targets
 *   - readouts : raw values in real units (the chart's Y axis is unitless)
 *   - STOP     : red button on the right; invokes the injected onStop
 *
 * The progress bar inside the YIELD column appears only when `targetYieldG`
 * is > 0 (workflow has a target). Otherwise the column shows plain weight.
 */
export interface LiveEspressoViewProps {
  acc: LiveShotAccumulator;
  onStop: () => void;
}

/**
 * Human-friendly label for the four substates that show up during an
 * espresso shot. Returns an empty string for any other substate so the
 * subtitle row collapses cleanly when the snapshot stream momentarily
 * reports something we didn't anticipate.
 */
const substateLabel = (s: MachineSubstate | undefined): string => {
  switch (s) {
    case 'preparingForShot':
      return 'Preparing';
    case 'preinfusion':
      return 'Preinfusion';
    case 'pouring':
      return 'Pouring';
    case 'pouringDone':
      return 'Done';
    default:
      return '';
  }
};

/**
 * Capital-first formatting: "ramp up" → "Ramp up". Distinct from
 * `text-transform: capitalize` (which would title-case every word) and
 * from `text-transform: uppercase` (which the substate uses).
 */
const capFirst = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

const fmtNumber = (n: number | undefined, digits: number, suffix: string): string => {
  if (n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
};

const fmtElapsed = (sec: number | undefined): string =>
  sec === undefined ? '—' : `${sec.toFixed(1)} s`;

const severityFor = (pct: number): 'normal' | 'near' | 'over' => {
  if (pct >= 100) return 'over';
  if (pct >= 80) return 'near';
  return 'normal';
};

/**
 * The STOP button's fill represents "how close are we to the next auto-stop
 * event". The DE1's actual stop priority is weight → volume → time
 * (`ShotSequencer`), but in real-time we just pick whichever trigger is
 * currently the most advanced — that's the one most likely to fire next.
 *
 * `time` is the floor: every profile has a total duration (sum of step
 * `seconds`), so timeProgress is always available when a profile is loaded.
 * Without a profile or a yield target, the bar pegs at zero — no auto-stop
 * info to display.
 */
export type StopTrigger = 'weight' | 'time' | 'none';

export interface StopProgress {
  /** 0..1 progress toward the leading trigger. Capped at 1 for layout. */
  value: number;
  /** Which trigger is currently leading (highest progress). */
  trigger: StopTrigger;
}

export const computeStopProgress = (
  weight: number,
  targetWeightG: number,
  elapsedSec: number,
  profile: ProfileSnapshot | null,
): StopProgress => {
  const profileTotalSec = (profile?.steps ?? []).reduce(
    (sum, s) => sum + (s.seconds ?? 0),
    0,
  );
  const weightP =
    targetWeightG > 0 && Number.isFinite(weight) && weight > 0
      ? weight / targetWeightG
      : 0;
  const timeP =
    profileTotalSec > 0 && elapsedSec > 0 ? elapsedSec / profileTotalSec : 0;

  if (weightP === 0 && timeP === 0) {
    return { value: 0, trigger: 'none' };
  }
  if (weightP >= timeP) {
    return { value: Math.min(1, weightP), trigger: 'weight' };
  }
  return { value: Math.min(1, timeP), trigger: 'time' };
};

/**
 * Legend trace declarations — colour and label per chart series. Kept here
 * (rather than imported from LiveShotChart) so a future split of the chart
 * into a separate module can't drift the colours apart silently. If you
 * change a stroke colour in `LiveShotChart`, change it here too.
 */
const LEGEND: Array<{
  key: TraceKey;
  name: string;
  color: string;
  suffix?: string;
}> = [
  { key: 'pressure', name: 'pressure', color: TRACE_COLOR.pressure },
  { key: 'flow', name: 'flow', color: TRACE_COLOR.flow },
  { key: 'weightFlow', name: 'weight flow', color: TRACE_COLOR.weightFlow },
  { key: 'weight', name: 'weight', color: TRACE_COLOR.weight, suffix: '÷10' },
  { key: 'mixTemp', name: 'mix temp', color: TRACE_COLOR.mixTemperature, suffix: '÷10' },
];

export const LiveEspressoView: Component<LiveEspressoViewProps> = (p) => {
  const prefs = useUserPrefs();
  // Per-shot visibility — seeded from the user's saved defaults so legend
  // toggles within a shot don't persist to the next, but the starting state
  // matches what the user configured in Settings.
  const [visibility, setVisibility] = createSignal<TraceVisibility>(
    prefs.traceVisibility(),
  );
  const toggleTrace = (key: TraceKey): void => {
    setVisibility({ ...visibility(), [key]: !visibility()[key] });
  };

  const r = (): LiveShotReadouts | null => p.acc.readouts();
  const profile = () => p.acc.currentProfile();
  const profileTitle = (): string | null => profile()?.title ?? null;
  const currentStepName = (): string | null => {
    const idx = r()?.profileFrame;
    if (idx === undefined) return null;
    return profile()?.steps?.[idx]?.name ?? null;
  };
  const elapsedSec = (): number | undefined => r()?.elapsedSec;
  const substateText = (): string => substateLabel(r()?.substate);

  // STOP button progress — reflects whichever auto-stop is currently leading
  // (weight target via `targetYieldG`, or the profile's total time).
  const stopProgress = createMemo<StopProgress>(() =>
    computeStopProgress(
      r()?.weight ?? NaN,
      p.acc.targetYieldG(),
      r()?.elapsedSec ?? 0,
      profile(),
    ),
  );
  const stopSeverity = createMemo<'normal' | 'near' | 'over'>(() =>
    severityFor(stopProgress().value * 100),
  );

  return (
    <div class="live-view" data-testid="live-espresso-view">
      <header class="live-view__header">
        <div class="live-view__title">
          <div class="live-view__title-row">
            <Show
              when={profileTitle()}
              fallback={
                <div class="live-view__profile" data-testid="live-view-profile">
                  Espresso
                </div>
              }
            >
              <div class="live-view__profile" data-testid="live-view-profile">
                {profileTitle()}
              </div>
            </Show>
            <Show when={currentStepName()}>
              <span class="live-view__step-sep" aria-hidden="true">·</span>
              <span
                class="live-view__step"
                data-testid="live-view-step"
                aria-label={`Current profile step ${currentStepName()}`}
              >
                step: {capFirst(currentStepName()!)}
              </span>
            </Show>
          </div>
          <div class="live-view__subtitle">
            <span class="live-view__operation">Espresso</span>
            <Show when={substateText()}>
              <span class="live-view__subtitle-sep" aria-hidden="true">·</span>
              <span
                class="live-view__state"
                data-substate={r()?.substate ?? 'idle'}
                data-testid="live-view-state"
              >
                {substateText()}
              </span>
            </Show>
          </div>
        </div>
        <div
          class="live-view__timer"
          data-testid="live-view-timer"
          aria-label={`Elapsed ${fmtElapsed(elapsedSec())}`}
        >
          <span class="live-view__timer-num">
            {elapsedSec() === undefined ? '—' : elapsedSec()!.toFixed(1)}
          </span>
          <span class="live-view__timer-unit">s</span>
        </div>
      </header>

      <ul class="live-view__legend" aria-label="Chart legend" data-testid="live-view-legend">
        <For each={LEGEND}>
          {(item) => {
            // Memo per item so the binding tracks visibility() correctly —
            // a bare `visibility()[item.key]` inside the For child reads
            // the signal but the attribute binding then captures the
            // resolved boolean, missing subsequent updates. The memo
            // forces a tracked re-evaluation on every visibility change.
            const isOn = createMemo(() => visibility()[item.key]);
            return (
              <li>
                <button
                  type="button"
                  class="legend-item"
                  classList={{ 'legend-item--hidden': !isOn() }}
                  aria-pressed={isOn()}
                  aria-label={`Toggle ${item.name} trace`}
                  data-testid={`legend-toggle-${item.key}`}
                  onClick={() => toggleTrace(item.key)}
                >
                  <span
                    class="legend-swatch"
                    style={{ background: item.color }}
                    aria-hidden="true"
                  />
                  <span class="legend-label">{item.name}</span>
                  <Show when={item.suffix}>
                    <span class="legend-suffix">{item.suffix}</span>
                  </Show>
                </button>
              </li>
            );
          }}
        </For>
        <li>
          <button
            type="button"
            class="legend-item legend-item--note"
            classList={{ 'legend-item--hidden': !visibility().targets }}
            aria-pressed={visibility().targets}
            aria-label="Toggle target traces"
            data-testid="legend-toggle-targets"
            onClick={() => toggleTrace('targets')}
          >
            <span class="legend-swatch legend-swatch--dashed" />
            <span class="legend-label">targets</span>
          </button>
        </li>
      </ul>

      <div class="live-view__chart">
        <LiveShotChart
          buffers={p.acc.buffers}
          frameCount={p.acc.frameCount}
          profile={p.acc.currentProfile}
          visibility={visibility}
          smoothing={prefs.chartSmoothing()}
        />
      </div>

      <footer class="live-view__readouts">
        <div class="readout">
          <div class="readout__label">PRESSURE</div>
          <div class="readout__value">{fmtNumber(r()?.pressure, 1, ' bar')}</div>
        </div>
        <div class="readout">
          <div class="readout__label">FLOW</div>
          <div class="readout__value">{fmtNumber(r()?.flow, 1, ' mL/s')}</div>
        </div>
        <div class="readout" data-testid="readout-weight">
          <div class="readout__label">WEIGHT</div>
          <div class="readout__value">{fmtNumber(r()?.weight, 1, ' g')}</div>
        </div>
        <div class="readout" data-testid="readout-volume">
          <div class="readout__label">VOLUME</div>
          <div class="readout__value">{fmtNumber(r()?.volumeMl, 0, ' mL')}</div>
        </div>
        <Show when={(profile()?.target_volume_count_start ?? 0) > 0}>
          <div class="readout" data-testid="readout-counted-volume">
            <div class="readout__label">COUNTED VOL</div>
            <div class="readout__value">
              {fmtNumber(r()?.countedVolumeMl, 0, ' mL')}
            </div>
          </div>
        </Show>
        <div class="readout">
          <div class="readout__label">TIME</div>
          <div class="readout__value">{fmtElapsed(r()?.elapsedSec)}</div>
        </div>
        <div class="readout">
          <div class="readout__label">MIX TEMP</div>
          <div class="readout__value">{fmtNumber(r()?.mixTemperature, 1, ' °C')}</div>
        </div>
        <button
          type="button"
          class="live-view__stop"
          data-severity={stopSeverity()}
          aria-label={`Stop brew (auto-stop ${(stopProgress().value * 100).toFixed(0)}%)`}
          onClick={p.onStop}
          data-testid="live-view-stop"
        >
          {/* Fill grows left-to-right behind the label. Layered visually
              under the content with z-index so the text stays legible. */}
          <span
            class="live-view__stop-fill"
            style={{ width: `${Math.min(100, stopProgress().value * 100)}%` }}
            data-testid="live-view-stop-fill"
            aria-hidden="true"
          />
          {/* Trigger badge — sibling of fill + content so it positions
              relative to the button (not the centered content span). */}
          <Show
            when={stopProgress().trigger === 'weight'}
            fallback={
              <Show when={stopProgress().trigger === 'time'}>
                <span
                  class="live-view__stop-trigger"
                  data-testid="live-view-stop-trigger-time"
                  aria-label="Time-based auto-stop"
                >
                  <ClockIcon size={12} />
                </span>
              </Show>
            }
          >
            <span
              class="live-view__stop-trigger"
              data-testid="live-view-stop-trigger-weight"
              aria-label="Weight-based auto-stop"
            >
              <ScaleIcon size={12} />
            </span>
          </Show>
          <span class="live-view__stop-content">
            <span class="live-view__stop-glyph">■</span>
            <span>STOP</span>
          </span>
        </button>
      </footer>
    </div>
  );
};
