import { Show, createMemo, type Accessor, type Component } from 'solid-js';
import type { MachineSnapshot, ShotSettingsSnapshot } from '../../snapshot';
import { ScaleIcon, WaterDropIcon } from '../icons';
import { DebouncedSliderField } from '../settings/DebouncedSliderField';
import { WATER_ADJUST_DELTA_ML, type WaterStopSensor } from '../../hotWater';

/**
 * Drawer body for a hot-water dispense. Layout mirrors the steam view's shell
 * (header → hero → optional slider → readouts + STOP), but the hero is the
 * *measured quantity in the cup*, not a clock — "is my cup full yet?" is the
 * question the user is actually asking, and it's how both Decaid and Decenza
 * present hot water.
 *
 * Both sensors get the same hero, because both are a measured amount against a
 * target and water is 1 g per mL:
 *
 *   - scale → grams poured / target g
 *   - count → millilitres integrated from group-head flow / target mL
 *
 * The elapsed-time fallback this view used to show without a scale is gone:
 * OverDose now integrates the flow itself (see `hotWater.ts`), so there is a
 * real measured quantity in both modes and no reason to fall back to a
 * stopwatch that answered a different question.
 *
 * Stop semantics: OverDose owns the stop outright — the machine is carrying
 * `volume = 0` and will not end the pour on its own before the derived duration
 * cap. So the bar and the STOP fill track *our* target, and the ± pair really
 * moves it mid-pour (the gateway's own sequencer latches at arm time and could
 * never have supported this).
 */
export interface LiveWaterViewProps {
  /** Latest machine snapshot — `mixTemperature` (live water temp) + the
   *  timestamp used for elapsed-time. */
  machineSnapshot: Accessor<MachineSnapshot | null>;
  /** Latest shotSettings — read only for the target *temperature* now. Volume
   *  no longer lives here: we write 0 to the machine and own the target. */
  shotSettings: Accessor<ShotSettingsSnapshot | null>;
  /** Epoch ms when the dispense began (snapshot timestamp on entering
   *  `hotWater`). 0 → not started. */
  startedAtMs: Accessor<number>;
  /** Live cup weight (g) from the scale. Undefined when no scale frame has
   *  arrived. */
  scaleWeight: Accessor<number | undefined>;
  /** Water counted so far (mL), integrated from group-head flow. */
  poured: Accessor<number>;
  /** Which reading is driving the stop — picks the hero's source and unit. */
  sensor: Accessor<WaterStopSensor>;
  /** Live target (mL ≈ g). 0 → no auto-stop; the hero counts up with no bar. */
  targetAmount: Accessor<number>;
  /** Vessel name for the header. Falls back to "Hot Water" when unset. */
  vesselName?: Accessor<string | null>;
  onStop: () => void;
  /** Nudge the live target mid-pour by ±{@link WATER_ADJUST_DELTA_ML}. Hidden
   *  when undefined or when there's no target to move. */
  onAdjust?: (deltaMl: number) => void;
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

/** DE1 hot-water flow range. The ceiling is 10.0 rather than
 *  `hot_water_form.dart`'s 8.0 because the gateway's own `HotWaterData`
 *  default ships `flow: 10` — see `domain/vessel.ts`. */
export const WATER_FLOW_MIN = 1.0;
export const WATER_FLOW_MAX = 10.0;
export const WATER_FLOW_STEP = 0.5;

export interface WaterStopProgress {
  /** 0..1 toward the target. Capped at 1 for layout. */
  value: number;
  /** Which reading is driving it, or `none` when there's no target. */
  trigger: WaterStopSensor | 'none';
}

/**
 * STOP-fill progress — measured against the live target, whichever sensor is
 * feeding it. A zero/absent target means no auto-stop, so nothing is being
 * counted toward and the fill stays empty.
 */
export const computeWaterStopProgress = (
  measured: number | undefined,
  target: number | undefined,
  sensor: WaterStopSensor,
): WaterStopProgress => {
  if (measured === undefined || !target || target <= 0) {
    return { value: 0, trigger: 'none' };
  }
  return {
    value: Math.min(1, Math.max(0, measured) / target),
    trigger: sensor,
  };
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

  const onScale = (): boolean => p.sensor() === 'scale';
  /** The amount in the cup, from whichever sensor is running. */
  const measured = (): number | undefined =>
    onScale() ? p.scaleWeight() : p.poured();
  const unit = (): string => (onScale() ? 'g' : 'mL');
  const target = (): number | undefined =>
    p.targetAmount() > 0 ? p.targetAmount() : undefined;

  const stop = createMemo<WaterStopProgress>(() =>
    computeWaterStopProgress(measured(), target(), p.sensor()),
  );
  const stopSeverity = createMemo<'normal' | 'near' | 'over'>(() =>
    severityFor(stop().value * 100),
  );

  // Nothing to nudge without a target — in manual mode the ± pair would be
  // adjusting a number that isn't driving anything.
  const showAdjust = (): boolean => !!p.onAdjust && p.targetAmount() > 0;

  return (
    <div class="live-view" data-testid="live-water-view">
      <header class="live-view__header">
        <div class="live-view__title">
          <div class="live-view__title-row">
            <div class="live-view__profile" data-testid="live-view-profile">
              {p.vesselName?.() || 'Hot Water'}
            </div>
          </div>
          <div class="live-view__subtitle">
            <span class="live-view__operation">Dispensing</span>
          </div>
        </div>
      </header>

      <section class="op-hero" data-testid="water-hero" data-mode={p.sensor()}>
        <div class="op-hero__primary" data-severity={stopSeverity()}>
          <span class="op-hero__num" data-testid="water-hero-value">
            {measured() === undefined ? '—' : Math.max(0, measured()!).toFixed(0)}
          </span>
          <span class="op-hero__unit">{unit()}</span>
        </div>
        <Show when={target()}>
          <div class="op-hero__target" data-testid="water-hero-target">
            / {target()!.toFixed(0)} {unit()}
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

        {/* ±10 mL hangs under the amount, the same cause-effect placement as
            steam's ±5s: see the number climbing → tap to move where it ends.
            Real because we own the stop; the gateway's sequencer latched its
            target at arm time and would have ignored this. */}
        <Show when={showAdjust()}>
          <div class="op-adjust-row" data-testid="water-adjust-row">
            <button
              type="button"
              class="op-adjust op-adjust--hero"
              data-testid="water-adjust-minus"
              aria-label={`Reduce target by ${WATER_ADJUST_DELTA_ML} millilitres`}
              onClick={() => p.onAdjust!(-WATER_ADJUST_DELTA_ML)}
            >
              −{WATER_ADJUST_DELTA_ML}
            </button>
            <button
              type="button"
              class="op-adjust op-adjust--hero"
              data-testid="water-adjust-plus"
              aria-label={`Increase target by ${WATER_ADJUST_DELTA_ML} millilitres`}
              onClick={() => p.onAdjust!(WATER_ADJUST_DELTA_ML)}
            >
              +{WATER_ADJUST_DELTA_ML}
            </button>
          </div>
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
            when={stop().trigger === 'scale'}
            fallback={
              <Show when={stop().trigger === 'flow'}>
                <span
                  class="live-view__stop-trigger"
                  data-testid="live-view-stop-trigger-flow"
                  aria-label="Counted-water auto-stop"
                >
                  <WaterDropIcon size={12} />
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
