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
  it('measures against the live target on the scale path', () => {
    expect(computeWaterStopProgress(75, 150, 'scale')).toEqual({
      value: 0.5,
      trigger: 'scale',
    });
  });

  it('reports the sensor from the start (value 0) so the icon is stable', () => {
    expect(computeWaterStopProgress(0, 150, 'scale')).toEqual({
      value: 0,
      trigger: 'scale',
    });
  });

  it('uses the same arithmetic on the counting path', () => {
    // Water is 1 g per mL, so mL-vs-mL is the same computation as g-vs-g.
    expect(computeWaterStopProgress(75, 150, 'flow')).toEqual({
      value: 0.5,
      trigger: 'flow',
    });
  });

  it('reports trigger="none" with no target (manual)', () => {
    expect(computeWaterStopProgress(75, 0, 'scale')).toEqual({
      value: 0,
      trigger: 'none',
    });
  });

  it('reports trigger="none" before any measurement arrives', () => {
    expect(computeWaterStopProgress(undefined, 150, 'scale')).toEqual({
      value: 0,
      trigger: 'none',
    });
  });

  it('caps at 1 after overshoot', () => {
    expect(computeWaterStopProgress(200, 150, 'scale').value).toBe(1);
  });
});

describe('LiveWaterView', () => {
  const renderView = (over: {
    snap?: MachineSnapshot | null;
    settings?: ShotSettingsSnapshot | null;
    startedAtMs?: number;
    scaleWeight?: number | undefined;
    poured?: number;
    sensor?: 'scale' | 'flow';
    targetAmount?: number;
    vesselName?: string | null;
    onAdjust?: ((d: number) => void) | null;
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
        poured={() => over.poured ?? 0}
        sensor={() => over.sensor ?? 'scale'}
        targetAmount={() => over.targetAmount ?? 150}
        vesselName={() => over.vesselName ?? null}
        onAdjust={'onAdjust' in over ? (over.onAdjust ?? undefined) : () => {}}
        onStop={over.onStop ?? (() => {})}
        flow={() => over.flow}
        onChangeFlow={onChangeFlowProp}
        showSlider={over.showSlider ?? false}
      />
    ));
  };

  describe('scale sensor (grams hero)', () => {
    it('hero shows measured grams over the target volume', () => {
      renderView({ scaleWeight: 112 });
      expect(screen.getByTestId('water-hero')).toHaveAttribute('data-mode', 'scale');
      expect(screen.getByTestId('water-hero-value')).toHaveTextContent('112');
      expect(screen.getByTestId('water-hero-target')).toHaveTextContent('/ 150 g');
    });

    it('hero bar fills to weight/target', () => {
      renderView({ scaleWeight: 75 });
      const fill = screen.getByTestId('water-hero-bar-fill') as HTMLElement;
      expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
    });

    it('STOP shows the weight trigger icon and fills by weight', () => {
      renderView({ scaleWeight: 75 });
      expect(
        screen.getByTestId('live-view-stop-trigger-weight'),
      ).toBeInTheDocument();
      const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
      expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
    });

    it('clamps a negative tare to 0 grams', () => {
      renderView({ scaleWeight: -1.2 });
      expect(screen.getByTestId('water-hero-value')).toHaveTextContent('0');
    });

    it('drops the bar + target when there is no target (manual)', () => {
      renderView({ scaleWeight: 40, targetAmount: 0 });
      expect(screen.queryByTestId('water-hero-bar-fill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('water-hero-target')).not.toBeInTheDocument();
    });
  });

  describe('flow sensor (counted-millilitres hero)', () => {
    it('hero shows counted millilitres over the target', () => {
      // No stopwatch fallback any more: OverDose integrates group-head flow,
      // so there is a real measured quantity without a scale too.
      renderView({ sensor: 'flow', poured: 96, targetAmount: 300 });
      expect(screen.getByTestId('water-hero')).toHaveAttribute('data-mode', 'flow');
      expect(screen.getByTestId('water-hero-value')).toHaveTextContent('96');
      expect(screen.getByTestId('water-hero-target')).toHaveTextContent('/ 300 mL');
    });

    it('STOP shows the counted-water trigger icon and fills by volume', () => {
      renderView({ sensor: 'flow', poured: 150, targetAmount: 300 });
      expect(screen.getByTestId('live-view-stop-trigger-flow')).toBeInTheDocument();
      const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
      expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
    });
  });

  describe('vessel name', () => {
    it('titles the view with the vessel', () => {
      renderView({ vesselName: 'Mug' });
      expect(screen.getByTestId('live-view-profile')).toHaveTextContent('Mug');
    });

    it('falls back to Hot Water when nothing was picked', () => {
      renderView({ vesselName: null });
      expect(screen.getByTestId('live-view-profile')).toHaveTextContent('Hot Water');
    });
  });

  describe('mid-pour adjust', () => {
    it('nudges the target both ways', () => {
      const onAdjust = vi.fn();
      renderView({ onAdjust });
      fireEvent.click(screen.getByTestId('water-adjust-plus'));
      expect(onAdjust).toHaveBeenCalledWith(10);
      fireEvent.click(screen.getByTestId('water-adjust-minus'));
      expect(onAdjust).toHaveBeenCalledWith(-10);
    });

    it('hides the pair when there is no target to move', () => {
      renderView({ onAdjust: vi.fn(), targetAmount: 0 });
      expect(screen.queryByTestId('water-adjust-row')).not.toBeInTheDocument();
    });

    it('hides the pair when no handler is wired', () => {
      renderView({ onAdjust: null });
      expect(screen.queryByTestId('water-adjust-row')).not.toBeInTheDocument();
    });
  });

  it('shows readouts: temp, target temp, flow, time', () => {
    renderView({ scaleWeight: 50, flow: 6 });
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
    renderView({ scaleWeight: 160 });
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
