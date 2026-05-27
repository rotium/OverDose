import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { LiveWaterView, computeWaterStopProgress } from './LiveWaterView';
import type { MachineSnapshot, ShotSettingsSnapshot } from '../../snapshot';

const mkSnap = (over: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  timestamp: '2026-05-27T08:00:05.000Z',
  state: { state: 'hotWater', substate: 'idle' },
  flow: 4,
  pressure: 0,
  targetFlow: 0,
  targetPressure: 0,
  mixTemperature: 88,
  groupTemperature: 90,
  targetMixTemperature: 90,
  targetGroupTemperature: 90,
  profileFrame: 0,
  steamTemperature: 0,
  ...over,
});

const mkSettings = (
  over: Partial<ShotSettingsSnapshot> = {},
): ShotSettingsSnapshot => ({
  steamSetting: 0,
  targetSteamTemp: 145,
  targetSteamDuration: 30,
  targetHotWaterTemp: 90,
  targetHotWaterVolume: 150,
  targetHotWaterDuration: 30,
  targetShotVolume: 36,
  groupTemp: 92,
  ...over,
});

describe('computeWaterStopProgress', () => {
  it('uses weight/target when a scale weight + volume target are present', () => {
    expect(computeWaterStopProgress(75, 150, 5, 30)).toEqual({
      value: 0.5,
      trigger: 'weight',
    });
  });

  it('reports trigger="weight" from the start (value 0) so the scale icon is stable', () => {
    expect(computeWaterStopProgress(0, 150, 5, 30)).toEqual({
      value: 0,
      trigger: 'weight',
    });
  });

  it('falls back to elapsed/duration when there is no scale (weight undefined)', () => {
    expect(computeWaterStopProgress(undefined, 150, 15, 30)).toEqual({
      value: 0.5,
      trigger: 'time',
    });
  });

  it('reports trigger="none" with no scale and no duration target', () => {
    expect(computeWaterStopProgress(undefined, 150, 15, undefined)).toEqual({
      value: 0,
      trigger: 'none',
    });
  });

  it('caps at 1 after overshoot', () => {
    expect(computeWaterStopProgress(200, 150, 5, 30).value).toBe(1);
  });
});

describe('LiveWaterView', () => {
  const renderView = (over: {
    snap?: MachineSnapshot | null;
    settings?: ShotSettingsSnapshot | null;
    startedAtMs?: number;
    scaleWeight?: number | undefined;
    scaleConnected?: boolean;
    onStop?: () => void;
    flow?: number | undefined;
    onChangeFlow?: ((v: number) => void) | null;
    showSlider?: boolean;
  } = {}) => {
    const [snap] = createSignal<MachineSnapshot | null>(
      'snap' in over ? (over.snap ?? null) : mkSnap(),
    );
    const [settings] = createSignal<ShotSettingsSnapshot | null>(
      'settings' in over ? (over.settings ?? null) : mkSettings(),
    );
    const onChangeFlowProp =
      'onChangeFlow' in over ? (over.onChangeFlow ?? undefined) : () => {};
    return render(() => (
      <LiveWaterView
        machineSnapshot={snap}
        shotSettings={settings}
        startedAtMs={() => over.startedAtMs ?? Date.parse('2026-05-27T08:00:00.000Z')}
        scaleWeight={() => over.scaleWeight}
        scaleConnected={() => over.scaleConnected ?? false}
        onStop={over.onStop ?? (() => {})}
        flow={() => over.flow}
        onChangeFlow={onChangeFlowProp}
        showSlider={over.showSlider ?? false}
      />
    ));
  };

  describe('scale connected (grams hero)', () => {
    it('hero shows measured grams over the target volume', () => {
      renderView({ scaleConnected: true, scaleWeight: 112 });
      expect(screen.getByTestId('water-hero')).toHaveAttribute('data-mode', 'scale');
      expect(screen.getByTestId('water-hero-value')).toHaveTextContent('112');
      expect(screen.getByTestId('water-hero-target')).toHaveTextContent('/ 150 g');
    });

    it('hero bar fills to weight/targetVolume', () => {
      renderView({ scaleConnected: true, scaleWeight: 75 });
      const fill = screen.getByTestId('water-hero-bar-fill') as HTMLElement;
      expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
    });

    it('STOP shows the weight trigger icon and fills by weight', () => {
      renderView({ scaleConnected: true, scaleWeight: 75 });
      expect(
        screen.getByTestId('live-view-stop-trigger-weight'),
      ).toBeInTheDocument();
      const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
      expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
    });

    it('clamps a negative tare to 0 grams', () => {
      renderView({ scaleConnected: true, scaleWeight: -1.2 });
      expect(screen.getByTestId('water-hero-value')).toHaveTextContent('0');
    });

    it('drops the bar + target when no volume target is set', () => {
      renderView({
        scaleConnected: true,
        scaleWeight: 40,
        settings: mkSettings({ targetHotWaterVolume: 0 }),
      });
      expect(screen.queryByTestId('water-hero-bar-fill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('water-hero-target')).not.toBeInTheDocument();
    });
  });

  describe('no scale (time-fallback hero)', () => {
    it('hero counts up elapsed seconds with the target volume as a sub-line', () => {
      // snapshot at :05, started at :00 → 5.0 s elapsed.
      renderView({ scaleConnected: false });
      expect(screen.getByTestId('water-hero')).toHaveAttribute('data-mode', 'time');
      expect(screen.getByTestId('water-hero-value')).toHaveTextContent('5.0');
      expect(screen.getByTestId('water-hero-target')).toHaveTextContent(
        'target 150 mL',
      );
    });

    it('STOP shows the time trigger icon and fills by elapsed/duration', () => {
      // 15s elapsed, 30s duration → 50%.
      renderView({
        scaleConnected: false,
        snap: mkSnap({ timestamp: '2026-05-27T08:00:15.000Z' }),
      });
      expect(screen.getByTestId('live-view-stop-trigger-time')).toBeInTheDocument();
      const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
      expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
    });

    it('falls back to the duration target line when no volume target is set', () => {
      renderView({
        scaleConnected: false,
        settings: mkSettings({ targetHotWaterVolume: 0 }),
      });
      expect(screen.getByTestId('water-hero-target')).toHaveTextContent(
        'target 30 s',
      );
    });
  });

  it('shows readouts: temp, target temp, flow, time', () => {
    renderView({ scaleConnected: true, scaleWeight: 50, flow: 6 });
    expect(screen.getByTestId('readout-water-temp')).toHaveTextContent('88.0 °C');
    expect(screen.getByTestId('readout-target-temp')).toHaveTextContent('90 °C');
    expect(screen.getByTestId('readout-flow')).toHaveTextContent('6.0 mL/s');
    expect(screen.getByTestId('readout-time')).toHaveTextContent('5.0 s');
  });

  it('renders em-dashes when no snapshot or settings have arrived yet', () => {
    renderView({ snap: null, settings: null, startedAtMs: 0 });
    expect(screen.getByTestId('readout-water-temp')).toHaveTextContent('—');
    expect(screen.getByTestId('readout-target-temp')).toHaveTextContent('—');
    expect(screen.getByTestId('readout-time')).toHaveTextContent('—');
  });

  it('STOP severity flips to "over" once weight passes the target volume', () => {
    renderView({ scaleConnected: true, scaleWeight: 160 });
    expect(screen.getByTestId('live-view-stop')).toHaveAttribute(
      'data-severity',
      'over',
    );
  });

  it('STOP invokes the onStop callback', () => {
    const onStop = vi.fn();
    renderView({ onStop });
    fireEvent.click(screen.getByTestId('live-view-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  describe('FLOW readout + slider', () => {
    it('FLOW readout shows em-dash when flow is undefined', () => {
      renderView({ flow: undefined });
      expect(screen.getByTestId('readout-flow')).toHaveTextContent('—');
    });

    it('does not render the slider by default', () => {
      renderView({ flow: 6 });
      expect(screen.queryByTestId('water-flow-slider-row')).not.toBeInTheDocument();
    });

    it('renders the slider when showSlider + onChangeFlow are provided', () => {
      renderView({ flow: 6, showSlider: true });
      expect(screen.getByTestId('water-flow-slider-row')).toBeInTheDocument();
      const slider = screen.getByTestId('water-flow-slider') as HTMLInputElement;
      expect(slider.value).toBe('6');
    });

    it('hides the slider when onChangeFlow is omitted', () => {
      renderView({ flow: 6, showSlider: true, onChangeFlow: null });
      expect(screen.queryByTestId('water-flow-slider-row')).not.toBeInTheDocument();
    });

    it('slider invokes onChangeFlow with the new value on commit', () => {
      const onChangeFlow = vi.fn();
      renderView({ flow: 4, showSlider: true, onChangeFlow });
      const slider = screen.getByTestId('water-flow-slider') as HTMLInputElement;
      slider.value = '5.5';
      fireEvent.input(slider);
      fireEvent.pointerUp(slider);
      expect(onChangeFlow).toHaveBeenCalledWith(5.5);
    });
  });
});
