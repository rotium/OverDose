import { Show, createMemo, type Accessor, type Component } from 'solid-js';
import type { MachineSnapshot, ShotSettingsSnapshot } from '../../snapshot';
import { ClockIcon, ScaleIcon } from '../icons';
import { DebouncedSliderField } from '../settings/DebouncedSliderField';

/**
 * Drawer body for a hot-water dispense. Layout mirrors the steam view's
 * shell (header → hero → optional slider → readouts + STOP), but the hero is
 * the *measured quantity in the cup*, not a clock:
 *
 *   - scale connected → grams poured / target g, with a fill bar. This is the
 *     question the user is actually asking ("is my cup full yet?"), and it's
 *     how both Decent.app and Decenza present hot water. Water is ~1 g/mL, so
 *     the target volume (mL) reads as grams.
 *   - no scale        → fall back to an elapsed-time count-up; there's no live
 *     measured quantity to show progress against, so the targets move to a
 *     muted sub-line and the bar is dropped.
 *
 * Stop semantics: the gateway auto-stops on its volume target (with the
 * duration as a safety cap), so the grams bar / STOP fill is a close proxy
 * for "how near the auto-stop are we" — we don't run a client-side
 * stop-on-weight. The current `hotWaterFlow` is adjustable mid-pour via the
 * optional slider (opt-in behind a user pref, like the steam-flow slider).
 */
export interface LiveWaterViewProps {
  /** Latest machine snapshot — `mixTemperature` (live water temp) + the
   *  timestamp used for elapsed-time. */
  machineSnapshot: Accessor<MachineSnapshot | null>;
  /** Latest shotSettings — target temp / volume / duration. May be null
   *  before the WS pushes a frame; the view degrades to em-dashes. */
  shotSettings: Accessor<ShotSettingsSnapshot | null>;
  /** Epoch ms when the dispense began (snapshot timestamp on entering
   *  `hotWater`). 0 → not started. */
  startedAtMs: Accessor<number>;
  /** Live cup weight (g) from the scale. Undefined when no scale frame has
   *  arrived. */
  scaleWeight: Accessor<number | undefined>;
  /** Whether a scale is connected — drives scale-first vs time-fallback hero. */
  scaleConnected: Accessor<boolean>;
  onStop: () => void;
  /** Current `hotWaterFlow` (mL/s) from machine settings. Undefined → readout
   *  shows em-dash; slider falls back to its min if visible. */
  flow?: Accessor<number | undefined>;
  /** Mid-pour hot-water-flow change handler. When provided AND `showSlider`
   *  is true, the slider is rendered. */
  onChangeFlow?: (mLPerSec: number) => void;
  /** Render the inline flow slider below the hero. The FLOW readout cell is
   *  unconditional — this only controls the slider. */
  showSlider?: boolean;
}

/** DE1 hot-water flow range, matching reaprime's `hot_water_form.dart`. */
export const WATER_FLOW_MIN = 1.0;
export const WATER_FLOW_MAX = 8.0;
export const WATER_FLOW_STEP = 0.5;

export type WaterStopTrigger = 'weight' | 'time' | 'none';
export interface WaterStopProgress {
  /** 0..1 toward the leading trigger. Capped at 1 for layout. */
  value: number;
  trigger: WaterStopTrigger;
}

/**
 * STOP-fill progress. With a scale + a volume target, weight is the live
 * measure that tracks the (volume-based) auto-stop most closely. Without a
 * scale, the duration cap is the only thing we can track live, so the fill
 * counts toward that. `weightG === undefined` is the "no scale" signal.
 */
export const computeWaterStopProgress = (
  weightG: number | undefined,
  targetVolume: number | undefined,
  elapsedSec: number | undefined,
  targetDurationSec: number | undefined,
): WaterStopProgress => {
  if (weightG !== undefined && targetVolume !== undefined && targetVolume > 0) {
    return {
      value: Math.min(1, Math.max(0, weightG) / targetVolume),
      trigger: 'weight',
    };
  }
  if (
    targetDurationSec !== undefined &&
    targetDurationSec > 0 &&
    elapsedSec !== undefined &&
    elapsedSec > 0
  ) {
    return { value: Math.min(1, elapsedSec / targetDurationSec), trigger: 'time' };
  }
  return { value: 0, trigger: 'none' };
};

const severityFor = (pct: number): 'normal' | 'near' | 'over' => {
  if (pct >= 100) return 'over';
  if (pct >= 80) return 'near';
  return 'normal';
};

const fmtNumber = (
  n: number | undefined | null,
  digits: number,
  suffix: string,
): string => {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
};

const fmtElapsed = (sec: number | undefined): string =>
  sec === undefined ? '—' : `${sec.toFixed(1)} s`;

export const LiveWaterView: Component<LiveWaterViewProps> = (p) => {
  const snap = (): MachineSnapshot | null => p.machineSnapshot();
  const settings = (): ShotSettingsSnapshot | null => p.shotSettings();

  const mixTemp = (): number | undefined => {
    const t = snap()?.mixTemperature;
    return typeof t === 'number' ? t : undefined;
  };
  const targetTemp = (): number | undefined => {
    const t = settings()?.targetHotWaterTemp;
    return typeof t === 'number' && t > 0 ? t : undefined;
  };
  const targetVolume = (): number | undefined => {
    const v = settings()?.targetHotWaterVolume;
    return typeof v === 'number' && v > 0 ? v : undefined;
  };
  const targetDurationSec = (): number | undefined => {
    const d = settings()?.targetHotWaterDuration;
    return typeof d === 'number' && d > 0 ? d : undefined;
  };

  // Elapsed = latest snapshot time − startedAtMs (machine clock, so replay
  // paths stay correct). Identical to the steam view.
  const elapsedSec = (): number | undefined => {
    const startMs = p.startedAtMs();
    const s = snap();
    if (startMs === 0 || !s) return undefined;
    const nowMs = Date.parse(s.timestamp);
    if (Number.isNaN(nowMs)) return undefined;
    return Math.max(0, (nowMs - startMs) / 1000);
  };

  const scaleMode = (): boolean => p.scaleConnected();
  const weight = (): number | undefined => p.scaleWeight();

  const stop = createMemo<WaterStopProgress>(() =>
    computeWaterStopProgress(
      scaleMode() ? (weight() ?? 0) : undefined,
      targetVolume(),
      elapsedSec(),
      targetDurationSec(),
    ),
  );
  const stopSeverity = createMemo<'normal' | 'near' | 'over'>(() =>
    severityFor(stop().value * 100),
  );

  // Muted target sub-line for the time-fallback hero. Volume is the thing
  // being poured, so it leads; duration is the fallback when no volume target.
  const timeTargetLine = (): string | null => {
    const v = targetVolume();
    if (v !== undefined) return `target ${v.toFixed(0)} mL`;
    const d = targetDurationSec();
    return d !== undefined ? `target ${d.toFixed(0)} s` : null;
  };

  return (
    <div class="live-view" data-testid="live-water-view">
      <header class="live-view__header">
        <div class="live-view__title">
          <div class="live-view__title-row">
            <div class="live-view__profile" data-testid="live-view-profile">
              Hot water
            </div>
          </div>
          <div class="live-view__subtitle">
            <span class="live-view__operation">Dispensing</span>
          </div>
        </div>
      </header>

      <section
        class="op-hero"
        data-testid="water-hero"
        data-mode={scaleMode() ? 'scale' : 'time'}
      >
        <Show
          when={scaleMode()}
          fallback={
            // No scale: elapsed count-up is the only thing moving live.
            <>
              <div class="op-hero__primary" data-severity={stopSeverity()}>
                <span class="op-hero__num" data-testid="water-hero-value">
                  {elapsedSec() === undefined ? '—' : elapsedSec()!.toFixed(1)}
                </span>
                <span class="op-hero__unit">s</span>
              </div>
              <Show when={timeTargetLine()}>
                <div class="op-hero__target" data-testid="water-hero-target">
                  {timeTargetLine()}
                </div>
              </Show>
            </>
          }
        >
          <div class="op-hero__primary" data-severity={stopSeverity()}>
            <span class="op-hero__num" data-testid="water-hero-value">
              {weight() === undefined ? '—' : Math.max(0, weight()!).toFixed(0)}
            </span>
            <span class="op-hero__unit">g</span>
          </div>
          <Show when={targetVolume()}>
            <div class="op-hero__target" data-testid="water-hero-target">
              / {targetVolume()!.toFixed(0)} g
            </div>
            <div
              class="op-hero__bar"
              data-severity={stopSeverity()}
              aria-hidden="true"
            >
              <span
                class="op-hero__bar-fill"
                data-testid="water-hero-bar-fill"
                style={{ width: `${Math.min(100, stop().value * 100)}%` }}
              />
            </div>
          </Show>
        </Show>
      </section>

      <Show when={p.showSlider && p.onChangeFlow}>
        <section
          class="live-flow-control"
          data-testid="water-flow-slider-row"
          aria-label="Hot water flow"
        >
          <span class="live-flow-control__label">Hot water flow</span>
          <DebouncedSliderField
            testId="water-flow-slider"
            value={p.flow ? p.flow() : undefined}
            onCommit={(v) => p.onChangeFlow!(v)}
            min={WATER_FLOW_MIN}
            max={WATER_FLOW_MAX}
            step={WATER_FLOW_STEP}
            ariaLabel="Hot water flow in millilitres per second"
            formatValue={(v) => `${v.toFixed(1)} mL/s`}
            class="live-flow-control__slider"
          />
        </section>
      </Show>

      <footer class="live-view__readouts live-view__readouts--water">
        <div class="readout" data-testid="readout-water-temp">
          <div class="readout__label">TEMP</div>
          <div class="readout__value">{fmtNumber(mixTemp(), 1, ' °C')}</div>
        </div>
        <div class="readout" data-testid="readout-target-temp">
          <div class="readout__label">TARGET</div>
          <div class="readout__value">{fmtNumber(targetTemp(), 0, ' °C')}</div>
        </div>
        <div class="readout" data-testid="readout-flow">
          <div class="readout__label">FLOW</div>
          <div class="readout__value">
            {fmtNumber(p.flow ? p.flow() : undefined, 1, ' mL/s')}
          </div>
        </div>
        <div class="readout" data-testid="readout-time">
          <div class="readout__label">TIME</div>
          <div class="readout__value">{fmtElapsed(elapsedSec())}</div>
        </div>
        <button
          type="button"
          class="live-view__stop"
          data-severity={stopSeverity()}
          aria-label={`Stop hot water (auto-stop ${(stop().value * 100).toFixed(0)}%)`}
          onClick={p.onStop}
          data-testid="live-view-stop"
        >
          <span
            class="live-view__stop-fill"
            style={{ width: `${Math.min(100, stop().value * 100)}%` }}
            data-testid="live-view-stop-fill"
            aria-hidden="true"
          />
          <Show
            when={stop().trigger === 'weight'}
            fallback={
              <Show when={stop().trigger === 'time'}>
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
