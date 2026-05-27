import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import {
  LiveFlushView,
  FLUSH_FLOW_MIN,
  FLUSH_FLOW_MAX,
  computeFlushStopProgress,
} from './LiveFlushView';
import type { MachineSnapshot } from '../../snapshot';

const mkSnap = (over: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  timestamp: '2026-05-27T08:00:05.000Z',
  state: { state: 'flush', substate: 'idle' },
  flow: 6,
  pressure: 1,
  targetFlow: 0,
  targetPressure: 0,
  mixTemperature: 92,
  groupTemperature: 93,
  targetMixTemperature: 92,
  targetGroupTemperature: 93,
  profileFrame: 0,
  steamTemperature: 0,
  ...over,
});

describe('computeFlushStopProgress', () => {
  it('returns trigger="none" before the flush has run', () => {
    expect(computeFlushStopProgress(0, 10)).toEqual({ value: 0, trigger: 'none' });
  });

  it('returns trigger="none" when no timeout target is known yet', () => {
    expect(computeFlushStopProgress(5, 0)).toEqual({ value: 0, trigger: 'none' });
  });

  it('scales linearly with elapsed/timeout', () => {
    expect(computeFlushStopProgress(5, 10)).toEqual({ value: 0.5, trigger: 'time' });
  });

  it('caps at 1 after overshoot', () => {
    expect(computeFlushStopProgress(15, 10)).toEqual({ value: 1, trigger: 'time' });
  });
});

describe('LiveFlushView', () => {
  const renderView = (over: {
    snap?: MachineSnapshot | null;
    startedAtMs?: number;
    targetDurationSec?: number | undefined;
    onStop?: () => void;
    flow?: number | undefined;
    onChangeFlow?: ((v: number) => void) | null;
    showSlider?: boolean;
  } = {}) => {
    const [snap] = createSignal<MachineSnapshot | null>(
      'snap' in over ? (over.snap ?? null) : mkSnap(),
    );
    const onChangeFlowProp =
      'onChangeFlow' in over ? (over.onChangeFlow ?? undefined) : () => {};
    return render(() => (
      <LiveFlushView
        machineSnapshot={snap}
        startedAtMs={() => over.startedAtMs ?? Date.parse('2026-05-27T08:00:00.000Z')}
        targetDurationSec={() =>
          'targetDurationSec' in over ? over.targetDurationSec : 10
        }
        onStop={over.onStop ?? (() => {})}
        flow={() => over.flow}
        onChangeFlow={onChangeFlowProp}
        showSlider={over.showSlider ?? false}
      />
    ));
  };

  it('hero counts down toward the flush timeout in whole seconds', () => {
    // 5s elapsed, 10s timeout → 5s remaining.
    renderView({ targetDurationSec: 10 });
    const timer = screen.getByTestId('live-view-timer');
    expect(timer).toHaveAttribute('data-mode', 'countdown');
    expect(timer).toHaveTextContent('5');
    expect(timer).toHaveTextContent('s left');
  });

  it('hero bar fills to elapsed/timeout', () => {
    renderView({ targetDurationSec: 10 });
    const fill = screen.getByTestId('flush-hero-bar-fill') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
  });

  it('counts up (no bar) before the timeout target is known', () => {
    // Machine-settings not fetched yet → no countdown target.
    renderView({ targetDurationSec: undefined });
    const timer = screen.getByTestId('live-view-timer');
    expect(timer).toHaveAttribute('data-mode', 'elapsed');
    expect(timer).toHaveTextContent('5');
    expect(timer).not.toHaveTextContent('left');
    expect(screen.queryByTestId('flush-hero-bar-fill')).not.toBeInTheDocument();
  });

  describe('de-emphasized flow + temp hint', () => {
    it('shows the flow setting and live mix temperature', () => {
      renderView({ flow: 6 });
      expect(screen.getByTestId('flush-hint-flow')).toHaveTextContent('6.0 mL/s');
      expect(screen.getByTestId('flush-hint-temp')).toHaveTextContent('92 °C');
    });

    it('falls back to the live snapshot flow when no flow setting is provided', () => {
      renderView({ flow: undefined, snap: mkSnap({ flow: 7 }) });
      expect(screen.getByTestId('flush-hint-flow')).toHaveTextContent('7.0 mL/s');
    });
  });

  it('STOP shows the time trigger and fills by elapsed/timeout', () => {
    renderView({ targetDurationSec: 10 });
    expect(screen.getByTestId('live-view-stop-trigger-time')).toBeInTheDocument();
    const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo(50, 0);
  });

  it('STOP severity flips to "over" past the timeout', () => {
    renderView({
      targetDurationSec: 10,
      snap: mkSnap({ timestamp: '2026-05-27T08:00:12.000Z' }),
    });
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

  describe('flow slider', () => {
    it('does not render by default', () => {
      renderView({ flow: 6 });
      expect(screen.queryByTestId('flush-flow-slider-row')).not.toBeInTheDocument();
    });

    it('renders when showSlider + onChangeFlow are provided, clamped to range', () => {
      renderView({ flow: 6, showSlider: true });
      const row = screen.getByTestId('flush-flow-slider-row');
      expect(row).toBeInTheDocument();
      const slider = screen.getByTestId('flush-flow-slider') as HTMLInputElement;
      expect(slider.min).toBe(String(FLUSH_FLOW_MIN));
      expect(slider.max).toBe(String(FLUSH_FLOW_MAX));
      expect(slider.value).toBe('6');
    });

    it('hides the slider when onChangeFlow is omitted', () => {
      renderView({ flow: 6, showSlider: true, onChangeFlow: null });
      expect(screen.queryByTestId('flush-flow-slider-row')).not.toBeInTheDocument();
    });

    it('slider invokes onChangeFlow with the new value on commit', () => {
      const onChangeFlow = vi.fn();
      renderView({ flow: 6, showSlider: true, onChangeFlow });
      const slider = screen.getByTestId('flush-flow-slider') as HTMLInputElement;
      slider.value = '4.5';
      fireEvent.input(slider);
      fireEvent.pointerUp(slider);
      expect(onChangeFlow).toHaveBeenCalledWith(4.5);
    });
  });
});
