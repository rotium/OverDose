import { Show, createMemo, type Accessor, type Component } from 'solid-js';
import type { MachineSnapshot } from '../../snapshot';
import { ClockIcon } from '../icons';
import { DebouncedSliderField } from '../settings/DebouncedSliderField';
// Reuse the steam view's well-tested countdown/elapsed/idle resolver — flush
// is the same "how long until auto-off?" question, just driven by flushTimeout.
import { computeHeaderTimer, type HeaderTimer } from './LiveSteamView';

/**
 * Drawer body for a group-head flush. A flush is a timed auto-off rinse, so
 * the hero is a clock — seconds remaining (or counting up before the timeout
 * is known), with a progress bar driving the STOP fill. This matches how both
 * Decent.app and Decenza present flush: time is the only first-class number.
 *
 * Live flow + temperature appear as a de-emphasized hint under the hero — not
 * a focal readout row, just "yes, hot water is actually flowing" confirmation.
 * `flushFlow` is adjustable mid-flush via the optional slider (opt-in behind a
 * user pref, like the steam-flow slider).
 */
export interface LiveFlushViewProps {
  /** Latest machine snapshot — `flow`, `mixTemperature`, and the timestamp
   *  used for elapsed-time. */
  machineSnapshot: Accessor<MachineSnapshot | null>;
  /** Epoch ms when the flush began (snapshot timestamp on entering `flush`).
   *  0 → not started. */
  startedAtMs: Accessor<number>;
  /** `flushTimeout` (s) from machine settings — the countdown target. When
   *  undefined (settings not fetched yet), the hero counts up instead. */
  targetDurationSec: Accessor<number | undefined>;
  onStop: () => void;
  /** Current `flushFlow` (mL/s) from machine settings. */
  flow?: Accessor<number | undefined>;
  /** Mid-flush flow change handler. When provided AND `showSlider` is true,
   *  the slider is rendered. */
  onChangeFlow?: (mLPerSec: number) => void;
  /** Render the inline flow slider below the hero. */
  showSlider?: boolean;
}

/** DE1 flush-flow range. Matches the Flush section in the Machine settings
 *  tab (1–10 mL/s) so a configured default is always representable here. */
export const FLUSH_FLOW_MIN = 1.0;
export const FLUSH_FLOW_MAX = 10.0;
export const FLUSH_FLOW_STEP = 0.5;

/** 0..1 progress toward `targetDurationSec` (the flush auto-off). Capped at 1
 *  for layout. `trigger` is 'time' whenever a target is set — flush only ever
 *  auto-stops on time. */
export const computeFlushStopProgress = (
  elapsedSec: number,
  targetDurationSec: number,
): { value: number; trigger: 'time' | 'none' } => {
  if (!(targetDurationSec > 0) || !(elapsedSec > 0)) {
    return { value: 0, trigger: 'none' };
  }
  return { value: Math.min(1, elapsedSec / targetDurationSec), trigger: 'time' };
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

export const LiveFlushView: Component<LiveFlushViewProps> = (p) => {
  const snap = (): MachineSnapshot | null => p.machineSnapshot();

  const flowNow = (): number | undefined => {
    const f = p.flow ? p.flow() : undefined;
    if (typeof f === 'number') return f;
    const live = snap()?.flow;
    return typeof live === 'number' ? live : undefined;
  };
  const mixTemp = (): number | undefined => {
    const t = snap()?.mixTemperature;
    return typeof t === 'number' ? t : undefined;
  };
  const targetDurationSec = (): number | undefined => p.targetDurationSec();

  // Elapsed = latest snapshot time − startedAtMs (machine clock). Identical to
  // the steam view.
  const elapsedSec = (): number | undefined => {
    const startMs = p.startedAtMs();
    const s = snap();
    if (startMs === 0 || !s) return undefined;
    const nowMs = Date.parse(s.timestamp);
    if (Number.isNaN(nowMs)) return undefined;
    return Math.max(0, (nowMs - startMs) / 1000);
  };

  const stop = createMemo<{ value: number; trigger: 'time' | 'none' }>(() =>
    computeFlushStopProgress(elapsedSec() ?? 0, targetDurationSec() ?? 0),
  );
  const stopSeverity = createMemo<'normal' | 'near' | 'over'>(() =>
    severityFor(stop().value * 100),
  );

  const heroTimer = createMemo<HeaderTimer>(() =>
    computeHeaderTimer(elapsedSec(), targetDurationSec()),
  );
  const heroSeverity = createMemo<'normal' | 'near' | 'over'>(() =>
    heroTimer().mode === 'countdown' ? stopSeverity() : 'normal',
  );
  // countdown: ceil so "1 s left" holds until truly zero; elapsed: floor.
  const heroWholeSec = (): number => {
    const t = heroTimer();
    if (t.mode === 'countdown') return Math.ceil(t.seconds);
    if (t.mode === 'elapsed') return Math.floor(t.seconds);
    return 0;
  };

  return (
    <div class="live-view" data-testid="live-flush-view">
      <header class="live-view__header">
        <div class="live-view__title">
          <div class="live-view__title-row">
            <div class="live-view__profile" data-testid="live-view-profile">
              Flush
            </div>
          </div>
          <div class="live-view__subtitle">
            <span class="live-view__operation">Group rinse</span>
          </div>
        </div>
      </header>

      <section class="op-hero" data-testid="flush-hero">
        <div
          class="op-hero__primary"
          data-testid="live-view-timer"
          data-mode={heroTimer().mode}
          data-severity={heroSeverity()}
          aria-label={
            heroTimer().mode === 'countdown'
              ? `${heroWholeSec()} seconds remaining`
              : heroTimer().mode === 'elapsed'
                ? `Elapsed ${heroWholeSec()} seconds`
                : 'Timer idle'
          }
        >
          <span class="op-hero__num">
            {heroTimer().mode === 'idle' ? '—' : heroWholeSec()}
          </span>
          <span class="op-hero__unit">
            {heroTimer().mode === 'countdown' ? 's left' : 's'}
          </span>
        </div>
        <Show when={stop().trigger === 'time'}>
          <div class="op-hero__bar" data-severity={stopSeverity()} aria-hidden="true">
            <span
              class="op-hero__bar-fill"
              data-testid="flush-hero-bar-fill"
              style={{ width: `${Math.min(100, stop().value * 100)}%` }}
            />
          </div>
        </Show>
        {/* De-emphasized "what's going on" hint — flow + temp, not a focal
            readout row. */}
        <div class="op-hint" data-testid="flush-hint">
          <span data-testid="flush-hint-flow">{fmtNumber(flowNow(), 1, ' mL/s')}</span>
          <span class="op-hint__sep" aria-hidden="true">·</span>
          <span data-testid="flush-hint-temp">{fmtNumber(mixTemp(), 0, ' °C')}</span>
        </div>
      </section>

      <Show when={p.showSlider && p.onChangeFlow}>
        <section
          class="live-flow-control"
          data-testid="flush-flow-slider-row"
          aria-label="Flush flow"
        >
          <span class="live-flow-control__label">Flush flow</span>
          <DebouncedSliderField
            testId="flush-flow-slider"
            value={p.flow ? p.flow() : undefined}
            onCommit={(v) => p.onChangeFlow!(v)}
            min={FLUSH_FLOW_MIN}
            max={FLUSH_FLOW_MAX}
            step={FLUSH_FLOW_STEP}
            ariaLabel="Flush flow in millilitres per second"
            formatValue={(v) => `${v.toFixed(1)} mL/s`}
            class="live-flow-control__slider"
          />
        </section>
      </Show>

      <footer class="live-view__readouts live-view__readouts--flush">
        <button
          type="button"
          class="live-view__stop"
          data-severity={stopSeverity()}
          aria-label={`Stop flush (auto-off ${(stop().value * 100).toFixed(0)}%)`}
          onClick={p.onStop}
          data-testid="live-view-stop"
        >
          <span
            class="live-view__stop-fill"
            style={{ width: `${Math.min(100, stop().value * 100)}%` }}
            data-testid="live-view-stop-fill"
            aria-hidden="true"
          />
          <Show when={stop().trigger === 'time'}>
            <span
              class="live-view__stop-trigger"
              data-testid="live-view-stop-trigger-time"
              aria-label="Time-based auto-stop"
            >
              <ClockIcon size={12} />
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
