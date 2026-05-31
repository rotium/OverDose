import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import {
  LiveSteamView,
  STEAM_ADJUST_DELTA_SEC,
  STEAM_DURATION_MIN_SEC,
  STEAM_DURATION_MAX_SEC,
  computeHeaderTimer,
  computeSteamStopProgress,
} from './LiveSteamView';
import type { MachineSnapshot, ShotSettingsSnapshot } from '../../snapshot';

const mkSnap = (over: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  timestamp: '2026-05-25T08:00:05.000Z',
  state: { state: 'steam', substate: 'idle' },
  flow: 0,
  pressure: 0,
  targetFlow: 0,
  targetPressure: 0,
  mixTemperature: 92,
  groupTemperature: 93,
  targetMixTemperature: 92,
  targetGroupTemperature: 93,
  profileFrame: 0,
  steamTemperature: 130,
  ...over,
});

const mkSettings = (over: Partial<ShotSettingsSnapshot> = {}): ShotSettingsSnapshot => ({
  steamSetting: 1,
  targetSteamTemp: 145,
  targetSteamDuration: 30,
  targetHotWaterTemp: 90,
  targetHotWaterVolume: 100,
  targetHotWaterDuration: 30,
  targetShotVolume: 36,
  groupTemp: 92,
  ...over,
});

describe('computeSteamStopProgress', () => {
  it('returns trigger="none" with zero progress before the session has run', () => {
    expect(computeSteamStopProgress(0, 30)).toEqual({ value: 0, trigger: 'none' });
  });

  it('returns trigger="none" when no target duration is set', () => {
    expect(computeSteamStopProgress(5, 0)).toEqual({ value: 0, trigger: 'none' });
  });

  it('scales linearly with elapsed/targetDuration', () => {
    expect(computeSteamStopProgress(15, 30)).toEqual({ value: 0.5, trigger: 'time' });
  });

  it('caps at 1 after overshoot', () => {
    expect(computeSteamStopProgress(40, 30)).toEqual({ value: 1, trigger: 'time' });
  });
});

describe('LiveSteamView', () => {
  const renderView = (over: {
    snap?: MachineSnapshot | null;
    settings?: ShotSettingsSnapshot | null;
    startedAtMs?: number;
    steamingStartedAtMs?: number;
    onStop?: () => void;
    onExtend?: ((deltaSec: number) => void) | null;
    steamFlow?: number | undefined;
    onChangeSteamFlow?: ((v: number) => void) | null;
    showSlider?: boolean;
    phase?: 'steaming' | 'purging' | 'idle';
    purgeStrategy?: 'firmware' | 'autoFlush' | 'manual';
  } = {}) => {
    // Distinguish "not specified" (undefined → use defaults) from "explicitly
    // null" (preserve null so the view renders its empty state).
    const [snap] = createSignal<MachineSnapshot | null>(
      'snap' in over ? (over.snap ?? null) : mkSnap(),
    );
    const [settings] = createSignal<ShotSettingsSnapshot | null>(
      'settings' in over ? (over.settings ?? null) : mkSettings(),
    );
    const onExtendProp =
      'onExtend' in over ? (over.onExtend ?? undefined) : () => {};
    const onChangeSteamFlowProp =
      'onChangeSteamFlow' in over
        ? (over.onChangeSteamFlow ?? undefined)
        : () => {};
    return render(() => (
      <LiveSteamView
        machineSnapshot={snap}
        shotSettings={settings}
        startedAtMs={() => over.startedAtMs ?? Date.parse('2026-05-25T08:00:00.000Z')}
        steamingStartedAtMs={
          'steamingStartedAtMs' in over
            ? () => over.steamingStartedAtMs!
            : undefined
        }
        phase={over.phase ? () => over.phase! : undefined}
        purgeStrategy={over.purgeStrategy ? () => over.purgeStrategy! : undefined}
        onStop={over.onStop ?? (() => {})}
        onExtend={onExtendProp}
        steamFlow={() => over.steamFlow}
        onChangeSteamFlow={onChangeSteamFlowProp}
        showSlider={over.showSlider ?? false}
      />
    ));
  };

  it('hero centerpiece is the countdown timer, not a temperature readout', () => {
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:10.000Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    // Old big steam-temp readout is gone; the hero now contains the timer.
    expect(screen.queryByTestId('steam-hero-value')).not.toBeInTheDocument();
    expect(screen.queryByTestId('steam-hero-bar-fill')).not.toBeInTheDocument();
    const hero = screen.getByTestId('steam-hero');
    expect(hero).toContainElement(screen.getByTestId('live-view-timer'));
  });

  it('shows readouts row with steam temp, target, time, duration', () => {
    renderView();
    expect(screen.getByTestId('readout-steam-temp')).toHaveTextContent('130.0 °C');
    expect(screen.getByTestId('readout-target-temp')).toHaveTextContent('145 °C');
    // 5 seconds elapsed: snapshot at 08:00:05, started at 08:00:00.
    expect(screen.getByTestId('readout-time')).toHaveTextContent('5.0 s');
    expect(screen.getByTestId('readout-duration')).toHaveTextContent('30 s');
  });

  it('renders em-dashes when no snapshot or settings have arrived yet', () => {
    renderView({ snap: null, settings: null, startedAtMs: 0 });
    expect(screen.getByTestId('readout-steam-temp')).toHaveTextContent('—');
    expect(screen.getByTestId('readout-target-temp')).toHaveTextContent('—');
    expect(screen.getByTestId('readout-time')).toHaveTextContent('—');
    expect(screen.getByTestId('readout-duration')).toHaveTextContent('—');
  });

  it('ready-chip reads "warming" when far below target', () => {
    renderView({ snap: mkSnap({ steamTemperature: 100 }) });
    const chip = screen.getByTestId('steam-ready-chip');
    expect(chip).toHaveTextContent('warming');
    expect(chip).toHaveAttribute('data-temp-severity', 'cold');
  });

  it('ready-chip reads "approaching" when within 8°C of target', () => {
    renderView({ snap: mkSnap({ steamTemperature: 140 }) });
    const chip = screen.getByTestId('steam-ready-chip');
    expect(chip).toHaveTextContent('approaching');
    expect(chip).toHaveAttribute('data-temp-severity', 'near');
  });

  it('ready-chip reads "ready" when within 2°C of target', () => {
    renderView({ snap: mkSnap({ steamTemperature: 144 }) });
    const chip = screen.getByTestId('steam-ready-chip');
    expect(chip).toHaveTextContent('ready');
    expect(chip).toHaveAttribute('data-temp-severity', 'at');
  });

  it('STOP fill scales by elapsed/targetSteamDuration', () => {
    // 15s elapsed, 30s target → 50%.
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:15.000Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
    // Trigger icon is always clock (time-based).
    expect(screen.getByTestId('live-view-stop-trigger-time')).toBeInTheDocument();
  });

  it('STOP severity flips to "over" past target duration', () => {
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:35.000Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    expect(screen.getByTestId('live-view-stop')).toHaveAttribute('data-severity', 'over');
  });

  it('STOP button shows no trigger icon when no target duration is set', () => {
    renderView({
      settings: mkSettings({ targetSteamDuration: 0 }),
    });
    expect(screen.queryByTestId('live-view-stop-trigger-time')).not.toBeInTheDocument();
  });

  it('STOP button invokes the onStop callback', () => {
    const onStop = vi.fn();
    renderView({ onStop });
    fireEvent.click(screen.getByTestId('live-view-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('hero timer counts down toward targetSteamDuration in whole seconds', () => {
    // 10s elapsed, 30s target → 20s remaining.
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:10.000Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    const timer = screen.getByTestId('live-view-timer');
    expect(timer).toHaveAttribute('data-mode', 'countdown');
    expect(timer).toHaveTextContent('20');
    expect(timer).toHaveTextContent('s left');
    // Sub-second precision is deliberately gone — see the countdown
    // ceil/floor rationale in LiveSteamView.heroTimerWholeSec.
    expect(timer).not.toHaveTextContent('20.0');
  });

  it('hero countdown ceils so "1 s left" persists until truly zero', () => {
    // 29.5s elapsed, 30s target → 0.5s remaining. Math.ceil → 1, not 0.
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:29.500Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    expect(screen.getByTestId('live-view-timer')).toHaveTextContent('1');
  });

  it('hero timer clamps at 0 once steaming runs past target duration', () => {
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:35.000Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    const timer = screen.getByTestId('live-view-timer');
    expect(timer).toHaveAttribute('data-mode', 'countdown');
    expect(timer).toHaveAttribute('data-severity', 'over');
    expect(timer).toHaveTextContent('0');
    expect(timer).not.toHaveTextContent('0.0');
  });

  it('hero timer falls back to counting up elapsed (whole-second floor) when no target duration is set', () => {
    // 12.5s elapsed → floor → 12. No "left" suffix in elapsed mode.
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:12.500Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
      settings: mkSettings({ targetSteamDuration: 0 }),
    });
    const timer = screen.getByTestId('live-view-timer');
    expect(timer).toHaveAttribute('data-mode', 'elapsed');
    expect(timer).toHaveTextContent('12');
    expect(timer).not.toHaveTextContent('12.5');
    expect(timer).not.toHaveTextContent('left');
  });

  it('countdown uses the steaming origin while TIME uses the session origin', () => {
    // Session started at 08:00:00 (warm-up), steam began flowing at 08:00:05,
    // now 08:00:15. TIME readout = 15 s (open-duration). Countdown = 30 s
    // target − 10 s of real steam = 20 s left (warm-up not counted).
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:15.000Z' }),
      settings: mkSettings({ targetSteamDuration: 30 }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
      steamingStartedAtMs: Date.parse('2026-05-25T08:00:05.000Z'),
    });
    expect(screen.getByTestId('readout-time')).toHaveTextContent('15.0 s');
    const timer = screen.getByTestId('live-view-timer');
    expect(timer).toHaveAttribute('data-mode', 'countdown');
    expect(timer).toHaveTextContent('20');
  });

  it('readouts row TIME stays elapsed even when the hero is counting down', () => {
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:10.000Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    expect(screen.getByTestId('readout-time')).toHaveTextContent('10.0 s');
  });

  describe('phase = "purging" (post-steam wand purge)', () => {
    // The DE1 runs a firmware-driven ~5 s wand purge after steam ends. The
    // skin can't know the precise remaining time (no MMR exposes it and the
    // gateway doesn't forward the puffing substate), so the view swaps the
    // countdown hero for a static "Purging steam wand…" indicator and hides
    // the ±5s adjusters (nothing to adjust). The readouts row stays so
    // anyone watching can still see temp + total time.

    it('replaces the countdown with the purge indicator', () => {
      renderView({ phase: 'purging' });
      expect(screen.getByTestId('steam-hero-purge')).toBeInTheDocument();
      expect(screen.queryByTestId('live-view-timer')).not.toBeInTheDocument();
    });

    it('shows the passive indicator (no button) for firmware/autoFlush', () => {
      renderView({ phase: 'purging', purgeStrategy: 'autoFlush' });
      expect(screen.getByTestId('steam-hero-purge')).toBeInTheDocument();
      expect(
        screen.queryByTestId('steam-hero-purge-button'),
      ).not.toBeInTheDocument();
    });

    it('manual strategy shows a Purge button that fires onStop (second idle)', () => {
      const onStop = vi.fn();
      renderView({ phase: 'purging', purgeStrategy: 'manual', onStop });
      // The passive indicator is replaced by an actionable button.
      expect(screen.queryByTestId('steam-hero-purge')).not.toBeInTheDocument();
      const btn = screen.getByTestId('steam-hero-purge-button');
      fireEvent.click(btn);
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('annotates the hero with data-phase="purging"', () => {
      renderView({ phase: 'purging' });
      expect(screen.getByTestId('steam-hero')).toHaveAttribute(
        'data-phase',
        'purging',
      );
    });

    it('hides the ±5s adjusters during purge', () => {
      renderView({
        phase: 'purging',
        // Pass the conditions that would normally show the adjusters so we
        // know the purge-gate is what's hiding them, not anything else.
        snap: mkSnap({ steamTemperature: 144 }),
      });
      expect(screen.queryByTestId('steam-adjust-row')).not.toBeInTheDocument();
    });

    it('hides the ready chip during purge', () => {
      renderView({ phase: 'purging' });
      expect(screen.queryByTestId('steam-ready-chip')).not.toBeInTheDocument();
    });

    it('subtitle swaps from "Milk steam" to "Wand purge"', () => {
      renderView({ phase: 'purging' });
      const view = screen.getByTestId('live-steam-view');
      expect(view).toHaveTextContent('Wand purge');
      expect(view).not.toHaveTextContent('Milk steam');
    });

    it('readouts row still renders (temp, target, time, duration, flow)', () => {
      renderView({ phase: 'purging', steamFlow: 1.4 });
      expect(screen.getByTestId('readout-steam-temp')).toBeInTheDocument();
      expect(screen.getByTestId('readout-target-temp')).toBeInTheDocument();
      expect(screen.getByTestId('readout-time')).toBeInTheDocument();
      expect(screen.getByTestId('readout-duration')).toBeInTheDocument();
      expect(screen.getByTestId('readout-flow')).toHaveTextContent('1.4 mL/s');
    });

    it('defaults to "steaming" when no phase prop is provided (back-compat)', () => {
      renderView();
      expect(screen.getByTestId('live-view-timer')).toBeInTheDocument();
      expect(screen.queryByTestId('steam-hero-purge')).not.toBeInTheDocument();
    });
  });

  describe('FLOW readout + slider', () => {
    it('FLOW readout renders the steamFlow value', () => {
      renderView({ steamFlow: 1.4 });
      expect(screen.getByTestId('readout-flow')).toHaveTextContent('1.4 mL/s');
    });

    it('FLOW readout shows em-dash when steamFlow is undefined', () => {
      renderView({ steamFlow: undefined });
      expect(screen.getByTestId('readout-flow')).toHaveTextContent('—');
    });

    it('does not render the slider by default (showSlider undefined)', () => {
      renderView({ steamFlow: 1.2 });
      expect(screen.queryByTestId('steam-flow-slider-row')).not.toBeInTheDocument();
    });

    it('does not render the slider when showSlider=false', () => {
      renderView({ steamFlow: 1.2, showSlider: false });
      expect(screen.queryByTestId('steam-flow-slider-row')).not.toBeInTheDocument();
    });

    it('renders the slider when showSlider=true and an onChangeSteamFlow handler is provided', () => {
      renderView({ steamFlow: 1.2, showSlider: true });
      expect(screen.getByTestId('steam-flow-slider-row')).toBeInTheDocument();
      const slider = screen.getByTestId('steam-flow-slider') as HTMLInputElement;
      expect(slider.value).toBe('1.2');
    });

    it('hides the slider even when showSlider=true if onChangeSteamFlow is omitted', () => {
      renderView({ steamFlow: 1.2, showSlider: true, onChangeSteamFlow: null });
      expect(screen.queryByTestId('steam-flow-slider-row')).not.toBeInTheDocument();
    });

    it('slider invokes onChangeSteamFlow with the new value on commit', () => {
      const onChangeSteamFlow = vi.fn();
      // No fake timers — let the slider's own debounce flush via pointer-up.
      renderView({
        steamFlow: 1.0,
        showSlider: true,
        onChangeSteamFlow,
      });
      const slider = screen.getByTestId('steam-flow-slider') as HTMLInputElement;
      slider.value = '1.5';
      fireEvent.input(slider);
      fireEvent.pointerUp(slider);
      expect(onChangeSteamFlow).toHaveBeenCalledWith(1.5);
    });
  });

  describe('-5s / +5s adjust buttons', () => {
    it('renders both buttons when a target duration is set and onExtend is provided', () => {
      renderView({ snap: mkSnap({ steamTemperature: 144 }) });
      expect(screen.getByTestId('steam-extend-minus')).toHaveTextContent(
        `−${STEAM_ADJUST_DELTA_SEC}s`,
      );
      expect(screen.getByTestId('steam-extend-plus')).toHaveTextContent(
        `+${STEAM_ADJUST_DELTA_SEC}s`,
      );
    });

    it('is hidden when no target duration is set (no countdown to adjust)', () => {
      renderView({
        snap: mkSnap({ steamTemperature: 144 }),
        settings: mkSettings({ targetSteamDuration: 0 }),
      });
      expect(screen.queryByTestId('steam-adjust-row')).not.toBeInTheDocument();
    });

    it('is hidden when onExtend is not provided', () => {
      renderView({ snap: mkSnap({ steamTemperature: 144 }), onExtend: null });
      expect(screen.queryByTestId('steam-adjust-row')).not.toBeInTheDocument();
    });

    it('is shown even while the boiler is still warming (no temp gate)', () => {
      // 100°C vs target 145°C → delta 45 → 'cold'. The duration is settable
      // regardless of boiler temp, so the adjusters stay available.
      renderView({ snap: mkSnap({ steamTemperature: 100 }) });
      expect(screen.getByTestId('steam-adjust-row')).toBeInTheDocument();
    });

    it('+5s invokes onExtend with the positive delta', () => {
      const onExtend = vi.fn();
      renderView({ snap: mkSnap({ steamTemperature: 144 }), onExtend });
      fireEvent.click(screen.getByTestId('steam-extend-plus'));
      expect(onExtend).toHaveBeenCalledWith(STEAM_ADJUST_DELTA_SEC);
    });

    it('-5s invokes onExtend with the negative delta', () => {
      const onExtend = vi.fn();
      renderView({ snap: mkSnap({ steamTemperature: 144 }), onExtend });
      fireEvent.click(screen.getByTestId('steam-extend-minus'));
      expect(onExtend).toHaveBeenCalledWith(-STEAM_ADJUST_DELTA_SEC);
    });

    it('disables the -5s button at the minimum bound', () => {
      renderView({
        snap: mkSnap({ steamTemperature: 144 }),
        settings: mkSettings({ targetSteamDuration: STEAM_DURATION_MIN_SEC }),
      });
      expect(screen.getByTestId('steam-extend-minus')).toBeDisabled();
      expect(screen.getByTestId('steam-extend-plus')).not.toBeDisabled();
    });

    it('disables the +5s button at the maximum bound', () => {
      renderView({
        snap: mkSnap({ steamTemperature: 144 }),
        settings: mkSettings({ targetSteamDuration: STEAM_DURATION_MAX_SEC }),
      });
      expect(screen.getByTestId('steam-extend-plus')).toBeDisabled();
      expect(screen.getByTestId('steam-extend-minus')).not.toBeDisabled();
    });
  });

  it('hero timer severity matches STOP severity in countdown mode', () => {
    // 28s elapsed, 30s target → ~93% (near).
    renderView({
      snap: mkSnap({ timestamp: '2026-05-25T08:00:28.000Z' }),
      startedAtMs: Date.parse('2026-05-25T08:00:00.000Z'),
    });
    expect(screen.getByTestId('live-view-timer')).toHaveAttribute(
      'data-severity',
      'near',
    );
  });
});

describe('computeHeaderTimer', () => {
  it('returns idle when elapsed is unknown', () => {
    expect(computeHeaderTimer(undefined, 30)).toEqual({ mode: 'idle', seconds: 0 });
  });

  it('returns elapsed when no target duration is set', () => {
    expect(computeHeaderTimer(7, undefined)).toEqual({ mode: 'elapsed', seconds: 7 });
    expect(computeHeaderTimer(7, 0)).toEqual({ mode: 'elapsed', seconds: 7 });
  });

  it('returns countdown when a target duration is set', () => {
    expect(computeHeaderTimer(10, 30)).toEqual({ mode: 'countdown', seconds: 20 });
  });

  it('clamps countdown to 0 past the target', () => {
    expect(computeHeaderTimer(40, 30)).toEqual({ mode: 'countdown', seconds: 0 });
  });
});
