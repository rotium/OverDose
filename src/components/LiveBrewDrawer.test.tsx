import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { LiveBrewDrawer } from './LiveBrewDrawer';
import { LiveShotProvider } from '../LiveShotContext';
import { WithPrefs } from '../test/prefs';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
} from '../snapshot';
import type { WorkflowSnapshot } from '../api';
import type { WsStatus, WsStream } from '../streams';

// Mock the chart — jsdom has no canvas, and chart correctness isn't this test's concern.
vi.mock('./LiveShotChart', () => ({
  LiveShotChart: () => <div data-testid="live-shot-chart-stub" />,
}));

const mkSnap = (over: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  timestamp: '2026-05-22T08:00:00.000Z',
  state: { state: 'idle', substate: 'idle' },
  flow: 0,
  pressure: 0,
  targetFlow: 0,
  targetPressure: 0,
  mixTemperature: 92,
  groupTemperature: 93,
  targetMixTemperature: 92,
  targetGroupTemperature: 93,
  profileFrame: 0,
  steamTemperature: 145,
  ...over,
});

const setupDrawer = (initial?: {
  workflow?: WorkflowSnapshot;
  shotSettings?: ShotSettingsSnapshot;
}) => {
  const [machine, setMachine] = createSignal<MachineSnapshot | null>(null);
  const [scale] = createSignal<ScaleMessage | null>(null);
  const [shotSettings, setShotSettings] = createSignal<ShotSettingsSnapshot | null>(
    initial?.shotSettings ?? null,
  );
  const status = createSignal<WsStatus>('open')[0];
  const machineStream: WsStream<MachineSnapshot> = { latest: machine, status };
  const scaleStream: WsStream<ScaleMessage> = { latest: scale, status };
  const shotSettingsStream: WsStream<ShotSettingsSnapshot> = {
    latest: shotSettings,
    status,
  };
  const fetchWorkflow = vi
    .fn<() => Promise<WorkflowSnapshot>>()
    .mockResolvedValue(initial?.workflow ?? { context: {} });
  const onStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  render(() => (
    <WithPrefs>
      <LiveShotProvider
        machineStream={machineStream}
        scaleStream={scaleStream}
        shotSettingsStream={shotSettingsStream}
        fetchWorkflow={fetchWorkflow}
        onStop={onStop}
      >
        <LiveBrewDrawer />
      </LiveShotProvider>
    </WithPrefs>
  ));

  return { setMachine, setShotSettings, onStop };
};

describe('LiveBrewDrawer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not mounted while machine is idle', () => {
    setupDrawer();
    expect(screen.queryByTestId('live-brew-drawer')).not.toBeInTheDocument();
  });

  it('mounts and shows the espresso view when substate enters preparingForShot', () => {
    const { setMachine } = setupDrawer();
    setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    expect(screen.getByTestId('live-brew-drawer')).toHaveAttribute('data-state', 'open');
    expect(screen.getByTestId('live-espresso-view')).toBeInTheDocument();
  });

  it('slides out as soon as state leaves espresso (responsive close)', async () => {
    const { setMachine } = setupDrawer();
    setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:01.000Z',
        state: { state: 'espresso', substate: 'pouring' },
        pressure: 6,
      }),
    );
    setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:02.000Z',
        state: { state: 'espresso', substate: 'pouringDone' },
      }),
    );
    expect(screen.getByTestId('live-brew-drawer')).toHaveAttribute('data-state', 'open');

    setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:03.000Z',
        state: { state: 'idle', substate: 'idle' },
      }),
    );
    // No tail wait — drawer enters closing right away.
    expect(screen.getByTestId('live-brew-drawer')).toHaveAttribute('data-state', 'closing');

    vi.advanceTimersByTime(280);
    await waitFor(() =>
      expect(screen.queryByTestId('live-brew-drawer')).not.toBeInTheDocument(),
    );
  });

  it('slides out as soon as the brew is aborted (no pouringDone, no wait)', async () => {
    const { setMachine } = setupDrawer();
    setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:01.000Z',
        state: { state: 'espresso', substate: 'pouring' },
      }),
    );
    setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:02.000Z',
        state: { state: 'idle', substate: 'idle' },
      }),
    );
    expect(screen.getByTestId('live-brew-drawer')).toHaveAttribute('data-state', 'closing');
    vi.advanceTimersByTime(280);
    await waitFor(() =>
      expect(screen.queryByTestId('live-brew-drawer')).not.toBeInTheDocument(),
    );
  });

  it('STOP button calls the injected onStop side-effect', () => {
    const { setMachine, onStop } = setupDrawer();
    setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    fireEvent.click(screen.getByTestId('live-view-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  describe('steam operation', () => {
    const mkSteamSettings = (): ShotSettingsSnapshot => ({
      steamSetting: 1,
      targetSteamTemp: 145,
      targetSteamDuration: 30,
      targetHotWaterTemp: 90,
      targetHotWaterVolume: 100,
      targetHotWaterDuration: 30,
      targetShotVolume: 36,
      groupTemp: 92,
    });

    it('opens with the steam view when machine state enters steam', () => {
      const { setMachine } = setupDrawer({ shotSettings: mkSteamSettings() });
      setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      expect(screen.getByTestId('live-brew-drawer')).toHaveAttribute('data-state', 'open');
      expect(screen.getByTestId('live-steam-view')).toBeInTheDocument();
      expect(screen.queryByTestId('live-espresso-view')).not.toBeInTheDocument();
    });

    it('slides out and unmounts when machine leaves steam state', async () => {
      const { setMachine } = setupDrawer({ shotSettings: mkSteamSettings() });
      setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      expect(screen.getByTestId('live-brew-drawer')).toHaveAttribute('data-state', 'open');

      setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:30.000Z',
          state: { state: 'idle', substate: 'idle' },
        }),
      );
      expect(screen.getByTestId('live-brew-drawer')).toHaveAttribute('data-state', 'closing');
      vi.advanceTimersByTime(280);
      await waitFor(() =>
        expect(screen.queryByTestId('live-brew-drawer')).not.toBeInTheDocument(),
      );
    });

    it('STOP in steam view calls the injected onStop side-effect', () => {
      const { setMachine, onStop } = setupDrawer({ shotSettings: mkSteamSettings() });
      setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      fireEvent.click(screen.getByTestId('live-view-stop'));
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('hero timer shows a whole-second countdown to targetSteamDuration', () => {
      const { setMachine } = setupDrawer({ shotSettings: mkSteamSettings() });
      setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      // 10s elapsed, 30s target → 20s remaining.
      setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:10.000Z',
          state: { state: 'steam', substate: 'idle' },
          steamTemperature: 144,
        }),
      );
      const timer = screen.getByTestId('live-view-timer');
      expect(timer).toHaveAttribute('data-mode', 'countdown');
      expect(timer).toHaveTextContent('20');
      expect(timer).toHaveTextContent('s left');
    });
  });
});
