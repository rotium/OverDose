import { Show, createMemo, type Accessor, type Component } from 'solid-js';
import type {
  MachineSnapshot,
  ShotSettingsSnapshot,
} from '../../snapshot';
import { ClockIcon } from '../icons';
import { DebouncedSliderField } from '../settings/DebouncedSliderField';

/**
 * Drawer body for a steam session. Layout:
 *
 *   - header   : "Steam" title + small ready-state chip (warming / approaching / ready)
 *   - hero     : giant countdown (or elapsed if no target) + the +10s extend button
 *                directly under it. This is the question the user is actually
 *                asking during a steam — "when does this stop?" — so it gets
 *                the whole canvas.
 *   - slider   : optional steam-flow control (opt-in via user pref)
 *   - readouts : STEAM TEMP / TARGET / TIME / DURATION / FLOW + STOP
 *
 * No chart. Steam telemetry is essentially a flat line at setpoint; a chart
 * would clutter the view without adding signal. The current temperature
 * lives in the readouts row; the ready-chip in the header carries the
 * binary "boiler warmed up yet?" question that the raw number would
 * otherwise obscure.
 *
 * Earlier shape had the temperature as the visual hero — that was wrong:
 * boiler temp is a static value once at setpoint, and the user is looking
 * at the milk jug not the screen by then. The countdown is the moving
 * target that drives attention back to the screen.
 */
export interface LiveSteamViewProps {
  /** Latest machine snapshot — provides `steamTemperature` and the
   *  timestamp used for elapsed-time calculation. */
  machineSnapshot: Accessor<MachineSnapshot | null>;
  /** Latest shotSettings — provides target temp + target duration. May be
   *  null while the WS hasn't yet pushed a frame; the view degrades to
   *  em-dashes. */
  shotSettings: Accessor<ShotSettingsSnapshot | null>;
  /** Epoch ms when the steam session began (snapshot.timestamp of the
   *  frame where state entered 'steam'). 0 → not started. Drives the
   *  readouts' TIME (open-duration, includes boiler warm-up). */
  startedAtMs: Accessor<number>;
  /** Epoch ms when steam actually started flowing (first `pouring` frame),
   *  excluding warm-up. Drives the countdown + STOP-fill so they reflect real
   *  steam time and match the firmware's `TargetSteamLength`. Defaults to
   *  `startedAtMs` when not provided (older callers / tests). 0 → not steaming
   *  yet, so the countdown shows idle. */
  steamingStartedAtMs?: Accessor<number>;
  /** Sub-phase of the steam session — distinguishes active steaming from
   *  the firmware's trailing wand purge (`airPurge` state). When `'purging'`
   *  the hero swaps to "Purging steam wand…" copy and the +/- adjusters
   *  hide (no useful action during the firmware-driven purge). Defaults to
   *  'steaming' when not provided, preserving older callers / tests. */
  phase?: Accessor<'steaming' | 'purging' | 'idle'>;
  /** Purge strategy (from user prefs). Only `manual` changes this view: while
   *  `phase === 'purging'` it shows a "Purge wand" button (which calls
   *  `onStop` — a second idle that fires the purge) instead of the passive
   *  "Purging…" indicator. `firmware`/`autoFlush` show the indicator (the
   *  purge is firmware- or skin-timer-driven). Defaults to `firmware`. */
  purgeStrategy?: Accessor<'firmware' | 'autoFlush' | 'manual'>;
  onStop: () => void;
  /** Add this many seconds to `targetSteamDuration` mid-session. The
   *  button is hidden when undefined or when no target is set. */
  onExtend?: (deltaSec: number) => void;
  /** Current `steamFlow` from machine settings (mL/s). Undefined → readout
   *  shows em-dash; slider falls back to its min if visible. */
  steamFlow?: Accessor<number | undefined>;
  /** Mid-session steam-flow change handler. When provided AND `showSlider`
   *  is true, the slider is rendered. */
  onChangeSteamFlow?: (mLPerSec: number) => void;
  /** Render the inline steam-flow slider below the hero. The FLOW readout
   *  cell is unconditional — this only controls the slider. */
  showSlider?: boolean;
}

/** DE1 steam-flow range, matching reaprime's native slider
 *  (`realtime_steam_feature.dart:269-271`). */
export const STEAM_FLOW_MIN = 0.4;
export const STEAM_FLOW_MAX = 2.0;
export const STEAM_FLOW_STEP = 0.1;

/** Increment for the -/+ steam-duration adjust buttons. 5s mirrors
 *  Decenza's `SteamPage.qml` (kulitorum/Decenza), which lets the user
 *  trim/extend in small steps both directions while milk technique is
 *  in motion. We previously had a single +10s button; smaller +/- pair
 *  is finer-grained and lets the user correct an overshoot. */
export const STEAM_ADJUST_DELTA_SEC = 5;
/** Bounds on the saved-default duration. Matches Decenza's clamp; the
 *  firmware accepts a wider range but these are the UX-meaningful ones. */
export const STEAM_DURATION_MIN_SEC = 5;
export const STEAM_DURATION_MAX_SEC = 120;

/** 0..1 progress toward `targetSteamDuration`. Capped at 1 for layout. */
export const computeSteamStopProgress = (
  elapsedSec: number,
  targetDurationSec: number,
): { value: number; trigger: 'time' | 'none' } => {
  if (!(targetDurationSec > 0) || !(elapsedSec > 0)) {
    return { value: 0, trigger: 'none' };
  }
  return { value: Math.min(1, elapsedSec / targetDurationSec), trigger: 'time' };
};

/**
 * What to show in the big header readout. Countdown is the default when a
 * target duration is set — it answers "when does this stop?" which is the
 * question the user is actually asking during a steam. Falls back to
 * counting-up elapsed when no target is set (machine running indefinitely).
 *
 * `remaining` is clamped to 0 once we pass the target — the STOP button's
 * `data-severity="over"` already signals overshoot, and a negative
 * countdown reads weird ("-2.3s left").
 */
export type HeaderTimerMode = 'countdown' | 'elapsed' | 'idle';
export interface HeaderTimer {
  mode: HeaderTimerMode;
  /** Seconds to render. Always non-negative. */
  seconds: number;
}
export const computeHeaderTimer = (
  elapsedSec: number | undefined,
  targetDurationSec: number | undefined,
): HeaderTimer => {
  if (elapsedSec === undefined) {
    return { mode: 'idle', seconds: 0 };
  }
  if (targetDurationSec !== undefined && targetDurationSec > 0) {
    return {
      mode: 'countdown',
      seconds: Math.max(0, targetDurationSec - elapsedSec),
    };
  }
  return { mode: 'elapsed', seconds: elapsedSec };
};

const severityFor = (pct: number): 'normal' | 'near' | 'over' => {
  if (pct >= 100) return 'over';
  if (pct >= 80) return 'near';
  return 'normal';
};

const fmtNumber = (n: number | undefined | null, digits: number, suffix: string): string => {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
};

const fmtElapsed = (sec: number | undefined): string =>
  sec === undefined ? '—' : `${sec.toFixed(1)} s`;

const fmtDuration = (sec: number | undefined | null): string =>
  sec === undefined || sec === null || sec <= 0 ? '—' : `${sec.toFixed(0)} s`;

export const LiveSteamView: Component<LiveSteamViewProps> = (p) => {
  const snap = (): MachineSnapshot | null => p.machineSnapshot();
  const settings = (): ShotSettingsSnapshot | null => p.shotSettings();
  const phase = (): 'steaming' | 'purging' | 'idle' =>
    p.phase ? p.phase() : 'steaming';
  const isPurging = (): boolean => phase() === 'purging';
  const purgeStrategy = (): 'firmware' | 'autoFlush' | 'manual' =>
    p.purgeStrategy ? p.purgeStrategy() : 'firmware';
  // Manual mode parks the wand on stop and waits for an explicit purge; show a
  // Purge button in place of the passive "Purging…" indicator.
  const showManualPurge = (): boolean =>
    isPurging() && purgeStrategy() === 'manual';

  const steamTemp = (): number | undefined => {
    const t = snap()?.steamTemperature;
    return typeof t === 'number' ? t : undefined;
  };
  const targetTemp = (): number | undefined => {
    const t = settings()?.targetSteamTemp;
    return typeof t === 'number' && t > 0 ? t : undefined;
  };
  const targetDurationSec = (): number | undefined => {
    const d = settings()?.targetSteamDuration;
    return typeof d === 'number' && d > 0 ? d : undefined;
  };

  // Elapsed since a given origin = "now (latest snapshot time) − origin".
  // Tracks the machine clock so playback / replay paths stay correct, and
  // doesn't depend on wall-clock drift between client and gateway.
  const elapsedSince = (startMs: number): number | undefined => {
    const s = snap();
    if (startMs === 0 || !s) return undefined;
    const nowMs = Date.parse(s.timestamp);
    if (Number.isNaN(nowMs)) return undefined;
    return Math.max(0, (nowMs - startMs) / 1000);
  };

  // Two origins:
  //  - TIME readout: session start (open-duration, incl. warm-up).
  //  - countdown / STOP-fill: first `pouring` frame, so the timer reflects
  //    real steam time and freezes naturally once steaming stops (the
  //    steaming origin stops advancing relative to a frozen `phase`).
  const timeElapsedSec = (): number | undefined => elapsedSince(p.startedAtMs());
  const steamingStartMs = (): number =>
    p.steamingStartedAtMs ? p.steamingStartedAtMs() : p.startedAtMs();
  const countdownElapsedSec = (): number | undefined =>
    elapsedSince(steamingStartMs());

  // "At-target" once within a small tolerance of setpoint. Pure UI cue —
  // doesn't gate anything; just lets the user see "ready" at a glance.
  const tempSeverity = createMemo<'cold' | 'near' | 'at'>(() => {
    const cur = steamTemp();
    const tgt = targetTemp();
    if (cur === undefined || tgt === undefined) return 'cold';
    const delta = Math.abs(cur - tgt);
    if (delta <= 2) return 'at';
    if (delta <= 8) return 'near';
    return 'cold';
  });

  const stopProgress = createMemo<{ value: number; trigger: 'time' | 'none' }>(() =>
    computeSteamStopProgress(countdownElapsedSec() ?? 0, targetDurationSec() ?? 0),
  );
  const stopSeverity = createMemo<'normal' | 'near' | 'over'>(() =>
    severityFor(stopProgress().value * 100),
  );

  // Hero timer: countdown when a target duration is set, elapsed otherwise.
  // The same severity thresholds as the STOP fill drive the countdown's
  // urgency tint, so the visual cue lines up across the view.
  const heroTimer = createMemo<HeaderTimer>(() =>
    computeHeaderTimer(countdownElapsedSec(), targetDurationSec()),
  );
  const heroTimerSeverity = createMemo<'normal' | 'near' | 'over'>(() => {
    if (heroTimer().mode !== 'countdown') return 'normal';
    return severityFor(stopProgress().value * 100);
  });

  // Whole-second rounding for the hero. Sub-second precision was visual
  // noise — the digits change every 100 ms but neither the user's milk
  // technique nor the steam-stop logic can act on that resolution.
  //
  //   countdown: ceil — "1 s left" sticks until we *actually* hit zero, so
  //              the display never undercuts the time you have left.
  //   elapsed:   floor — "5 s" means at least 5 seconds have passed.
  const heroTimerWholeSec = (): number => {
    const t = heroTimer();
    if (t.mode === 'countdown') return Math.ceil(t.seconds);
    if (t.mode === 'elapsed') return Math.floor(t.seconds);
    return 0;
  };

  const readyLabel = (): string => {
    switch (tempSeverity()) {
      case 'at':
        return 'ready';
      case 'near':
        return 'approaching';
      default:
        return 'warming';
    }
  };

  // Adjust-button visibility + per-direction enablement. Shown whenever
  // there's a countdown to adjust — the duration is just a number, settable
  // regardless of boiler temp, so the buttons are available from the start of
  // steam (no warming-up gate). Hidden only when there's no countdown and
  // during the post-steam wand purge (firmware-driven; nothing to extend or
  // trim). Per-button disabled-state enforces the bounds so the user doesn't
  // burn taps hammering against a clamp.
  const showAdjusters = (): boolean =>
    !!p.onExtend && heroTimer().mode === 'countdown' && !isPurging();
  const currentDurationSec = (): number => targetDurationSec() ?? 0;
  const canDecreaseSteam = (): boolean =>
    currentDurationSec() > STEAM_DURATION_MIN_SEC;
  const canIncreaseSteam = (): boolean =>
    currentDurationSec() < STEAM_DURATION_MAX_SEC;

  return (
    <div class="live-view" data-testid="live-steam-view">
      <header class="live-view__header">
        <div class="live-view__title">
          <div class="live-view__title-row">
            <div class="live-view__profile" data-testid="live-view-profile">
              Steam
            </div>
            {/* Ready chip — small status pill next to the title. Carries the
                binary "is the boiler at temp?" signal without competing
                with the countdown for visual weight. Hidden during the
                post-steam wand purge — the boiler state is no longer the
                operative cue (the firmware is winding down). */}
            <Show when={!isPurging()}>
              <span
                class="steam-ready-chip"
                data-testid="steam-ready-chip"
                data-temp-severity={tempSeverity()}
                aria-label={`Boiler ${readyLabel()}`}
              >
                {readyLabel()}
              </span>
            </Show>
          </div>
          <div class="live-view__subtitle">
            <span class="live-view__operation">
              {isPurging() ? 'Wand purge' : 'Milk steam'}
            </span>
          </div>
        </div>
      </header>

      <section
        class="steam-hero"
        classList={{
          'steam-hero--countdown': !isPurging(),
          'steam-hero--purging': isPurging(),
        }}
        data-testid="steam-hero"
        data-phase={phase()}
      >
        <Show
          when={!isPurging()}
          fallback={
            showManualPurge() ? (
              // Manual purge: steam has stopped and the wand is parked. The
              // user fires the purge (a second idle) when ready — e.g. after
              // lifting the wand clear of the milk.
              <button
                type="button"
                class="steam-hero__purge-button"
                data-testid="steam-hero-purge-button"
                onClick={p.onStop}
                aria-label="Purge steam wand"
              >
                <span class="steam-hero__purge-glyph" aria-hidden="true">
                  ⟳
                </span>
                <span class="steam-hero__purge-label">Purge wand</span>
              </button>
            ) : (
              // Firmware- or auto-flush-driven wand purge after steam ends.
              // ~5 s, timing not known precisely on our side (see
              // [[starter-skin-vocabulary]]). No countdown — a fake one would
              // lie. The hero communicates "the machine is doing its thing,
              // wait" while the readouts keep the temp/time numbers visible.
              <div
                class="steam-hero__purge"
                data-testid="steam-hero-purge"
                role="status"
                aria-live="polite"
              >
                <span class="steam-hero__purge-glyph" aria-hidden="true">
                  ⟳
                </span>
                <span class="steam-hero__purge-label">Purging steam wand…</span>
              </div>
            )
          }
        >
          <div
            class="steam-hero__timer"
            data-testid="live-view-timer"
            data-mode={heroTimer().mode}
            data-severity={heroTimerSeverity()}
            aria-label={
              heroTimer().mode === 'countdown'
                ? `${heroTimerWholeSec()} seconds remaining`
                : heroTimer().mode === 'elapsed'
                  ? `Elapsed ${heroTimerWholeSec()} seconds`
                  : 'Timer idle'
            }
          >
            <span class="steam-hero__timer-num">
              {heroTimer().mode === 'idle' ? '—' : heroTimerWholeSec()}
            </span>
            <span class="steam-hero__timer-unit">
              {heroTimer().mode === 'countdown' ? 's left' : 's'}
            </span>
          </div>
        </Show>
        {/* -5s / +5s adjust pair hangs under the countdown so the cause-
            effect link reads visually: "see the timer running out → tap
            this to keep going". Hidden while the boiler is still warming
            (cold severity) — nothing to adjust until steam is real. Each
            button disables at the bound so the user doesn't burn taps
            against a clamp. */}
        <Show when={showAdjusters()}>
          <div class="steam-adjust-row" data-testid="steam-adjust-row">
            <button
              type="button"
              class="steam-extend steam-extend--hero"
              data-testid="steam-extend-minus"
              aria-label={`Trim steam duration by ${STEAM_ADJUST_DELTA_SEC} seconds`}
              disabled={!canDecreaseSteam()}
              onClick={() => p.onExtend!(-STEAM_ADJUST_DELTA_SEC)}
            >
              −{STEAM_ADJUST_DELTA_SEC}s
            </button>
            <button
              type="button"
              class="steam-extend steam-extend--hero"
              data-testid="steam-extend-plus"
              aria-label={`Extend steam duration by ${STEAM_ADJUST_DELTA_SEC} seconds`}
              disabled={!canIncreaseSteam()}
              onClick={() => p.onExtend!(STEAM_ADJUST_DELTA_SEC)}
            >
              +{STEAM_ADJUST_DELTA_SEC}s
            </button>
          </div>
        </Show>
      </section>

      <Show when={p.showSlider && p.onChangeSteamFlow}>
        <section
          class="live-flow-control"
          data-testid="steam-flow-slider-row"
          aria-label="Steam flow"
        >
          <span class="live-flow-control__label">Steam flow</span>
          <DebouncedSliderField
            testId="steam-flow-slider"
            value={p.steamFlow ? p.steamFlow() : undefined}
            onCommit={(v) => p.onChangeSteamFlow!(v)}
            min={STEAM_FLOW_MIN}
            max={STEAM_FLOW_MAX}
            step={STEAM_FLOW_STEP}
            ariaLabel="Steam flow in millilitres per second"
            formatValue={(v) => `${v.toFixed(1)} mL/s`}
            class="live-flow-control__slider"
          />
        </section>
      </Show>

      <footer class="live-view__readouts live-view__readouts--steam">
        <div class="readout" data-testid="readout-steam-temp">
          <div class="readout__label">STEAM TEMP</div>
          <div class="readout__value">{fmtNumber(steamTemp(), 1, ' °C')}</div>
        </div>
        <div class="readout" data-testid="readout-target-temp">
          <div class="readout__label">TARGET</div>
          <div class="readout__value">{fmtNumber(targetTemp(), 0, ' °C')}</div>
        </div>
        <div class="readout" data-testid="readout-time">
          <div class="readout__label">TIME</div>
          <div class="readout__value">{fmtElapsed(timeElapsedSec())}</div>
        </div>
        <div class="readout" data-testid="readout-duration">
          <div class="readout__label">DURATION</div>
          <div class="readout__value">{fmtDuration(targetDurationSec())}</div>
        </div>
        <div class="readout" data-testid="readout-flow">
          <div class="readout__label">FLOW</div>
          <div class="readout__value">
            {fmtNumber(p.steamFlow ? p.steamFlow() : undefined, 1, ' mL/s')}
          </div>
        </div>
        <button
          type="button"
          class="live-view__stop"
          data-severity={stopSeverity()}
          aria-label={`Stop steam (auto-stop ${(stopProgress().value * 100).toFixed(0)}%)`}
          onClick={p.onStop}
          data-testid="live-view-stop"
        >
          <span
            class="live-view__stop-fill"
            style={{ width: `${Math.min(100, stopProgress().value * 100)}%` }}
            data-testid="live-view-stop-fill"
            aria-hidden="true"
          />
          <Show when={stopProgress().trigger === 'time'}>
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
