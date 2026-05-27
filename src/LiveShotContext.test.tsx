import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { LiveShotProvider, useLiveShot } from './LiveShotContext';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
} from './snapshot';
import type { MachineSettingsSnapshot, WorkflowSnapshot } from './api';
import type { WsStream, WsStatus } from './streams';

/**
 * Test rig: a Probe child reads the context and exposes the accumulator on
 * window so each assertion can poke it directly. Mounting LiveShotProvider
 * via render() keeps Solid's owner happy (createSignal needs an owner).
 */
const Probe = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = useLiveShot();
  (globalThis as unknown as { __live: typeof ctx }).__live = ctx;
  return null;
};

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

interface Rig {
  machineStream: WsStream<MachineSnapshot>;
  scaleStream: WsStream<ScaleMessage>;
  shotSettingsStream: WsStream<ShotSettingsSnapshot>;
  setMachine: (s: MachineSnapshot | null) => void;
  setScale: (s: ScaleMessage | null) => void;
  setShotSettings: (s: ShotSettingsSnapshot | null) => void;
  fetchWorkflow: ReturnType<typeof vi.fn<() => Promise<WorkflowSnapshot>>>;
  onStop: ReturnType<typeof vi.fn<() => Promise<void>>>;
  onUpdateShotSettings: ReturnType<
    typeof vi.fn<(s: ShotSettingsSnapshot) => Promise<void>>
  >;
  onFetchMachineSettings: ReturnType<
    typeof vi.fn<() => Promise<MachineSettingsSnapshot | null>>
  >;
  onUpdateMachineSettings: ReturnType<
    typeof vi.fn<(p: Partial<MachineSettingsSnapshot>) => Promise<void>>
  >;
}

const buildRig = (initial: {
  machine?: MachineSnapshot | null;
  scale?: ScaleMessage | null;
  shotSettings?: ShotSettingsSnapshot | null;
  workflow?: WorkflowSnapshot;
  machineSettings?: MachineSettingsSnapshot | null;
} = {}): Rig => {
  const [machine, setMachine] = createSignal<MachineSnapshot | null>(initial.machine ?? null);
  const [scale, setScale] = createSignal<ScaleMessage | null>(initial.scale ?? null);
  const [shotSettings, setShotSettings] = createSignal<ShotSettingsSnapshot | null>(
    initial.shotSettings ?? null,
  );
  const status = createSignal<WsStatus>('open')[0];
  return {
    machineStream: { latest: machine, status },
    scaleStream: { latest: scale, status },
    shotSettingsStream: { latest: shotSettings, status },
    setMachine,
    setScale,
    setShotSettings,
    fetchWorkflow: vi
      .fn<() => Promise<WorkflowSnapshot>>()
      .mockResolvedValue(initial.workflow ?? { context: {} }),
    onStop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onUpdateShotSettings: vi
      .fn<(s: ShotSettingsSnapshot) => Promise<void>>()
      .mockResolvedValue(undefined),
    onFetchMachineSettings: vi
      .fn<() => Promise<MachineSettingsSnapshot | null>>()
      .mockResolvedValue(initial.machineSettings ?? null),
    onUpdateMachineSettings: vi
      .fn<(p: Partial<MachineSettingsSnapshot>) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
};

const mount = (rig: Rig) =>
  render(() => (
    <LiveShotProvider
      machineStream={rig.machineStream}
      scaleStream={rig.scaleStream}
      shotSettingsStream={rig.shotSettingsStream}
      fetchWorkflow={rig.fetchWorkflow}
      onStop={rig.onStop}
      onUpdateShotSettings={rig.onUpdateShotSettings}
      onFetchMachineSettings={rig.onFetchMachineSettings}
      onUpdateMachineSettings={rig.onUpdateMachineSettings}
    >
      <Probe />
    </LiveShotProvider>
  ));

const liveCtx = () =>
  (globalThis as unknown as { __live: ReturnType<typeof useLiveShot> }).__live;

describe('LiveShotProvider', () => {
  it('starts idle and stays idle while the machine reports non-espresso states', () => {
    const rig = buildRig({ machine: mkSnap({ state: { state: 'idle', substate: 'idle' } }) });
    mount(rig);
    expect(liveCtx().accumulator.status()).toBe('idle');
    rig.setMachine(mkSnap({ state: { state: 'heating', substate: 'idle' } }));
    expect(liveCtx().accumulator.status()).toBe('idle');
  });

  it('transitions to recording on substate "preparingForShot" and appends subsequent frames', () => {
    const rig = buildRig();
    mount(rig);

    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:00.000Z',
        state: { state: 'espresso', substate: 'preparingForShot' },
      }),
    );
    expect(liveCtx().accumulator.status()).toBe('recording');

    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:01.000Z',
        state: { state: 'espresso', substate: 'preinfusion' },
        pressure: 2,
        flow: 0.5,
        mixTemperature: 90,
      }),
    );
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:02.000Z',
        state: { state: 'espresso', substate: 'pouring' },
        pressure: 8,
        flow: 2,
        mixTemperature: 92,
      }),
    );

    const acc = liveCtx().accumulator;
    expect(acc.frameCount()).toBe(3);
    expect(acc.buffers.pressure[2]).toBe(8);
    expect(acc.readouts()?.pressure).toBe(8);
    expect(acc.readouts()?.elapsedSec).toBeCloseTo(2);
  });

  it('picks up scale weightFlow on each append', () => {
    const rig = buildRig({
      scale: {
        timestamp: '2026-05-22T08:00:00.500Z',
        weight: 12.5,
        weightFlow: 2.3,
        batteryLevel: 80,
      },
    });
    mount(rig);
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:00.000Z',
        state: { state: 'espresso', substate: 'preparingForShot' },
      }),
    );
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:01.000Z',
        state: { state: 'espresso', substate: 'pouring' },
      }),
    );
    expect(liveCtx().accumulator.buffers.weightFlow[1]).toBe(2.3);
  });

  it('picks up scale weight on each append', () => {
    const rig = buildRig({
      scale: {
        timestamp: '2026-05-22T08:00:00.500Z',
        weight: 12.5,
        weightFlow: 2.1,
        batteryLevel: 80,
      },
    });
    mount(rig);
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:00.000Z',
        state: { state: 'espresso', substate: 'preparingForShot' },
      }),
    );
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:01.000Z',
        state: { state: 'espresso', substate: 'pouring' },
      }),
    );
    const acc = liveCtx().accumulator;
    expect(acc.buffers.weight[1]).toBe(12.5);
  });

  it('weight is NaN when scale stream reports disconnected status frames', () => {
    const rig = buildRig({ scale: { status: 'disconnected' } });
    mount(rig);
    rig.setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:01.000Z',
        state: { state: 'espresso', substate: 'pouring' },
      }),
    );
    expect(Number.isNaN(liveCtx().accumulator.buffers.weight[1]!)).toBe(true);
  });

  it('captures targetYield from fetchWorkflow once the request resolves', async () => {
    const rig = buildRig({ workflow: { context: { targetYield: 36 } } });
    mount(rig);
    rig.setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    expect(rig.fetchWorkflow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(liveCtx().accumulator.targetYieldG()).toBe(36));
  });

  it('freezes immediately when state leaves espresso (no 4 s tail wait)', () => {
    // Trade-off note: the gateway's `ShotSequencer` keeps recording ~4 s
    // past this point (scale-settling tail). We deliberately don't
    // mirror that wait — it made the drawer feel "stuck" while nothing
    // visibly happened. Instead we freeze + close immediately and accept
    // a small "chart extends" moment in LastShotCard once /shots/latest
    // catches up with the persisted record. See shot_sequencer.dart:314.
    const rig = buildRig();
    mount(rig);
    rig.setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:02.000Z',
        state: { state: 'espresso', substate: 'pouringDone' },
        pressure: 6,
      }),
    );
    const acc = liveCtx().accumulator;
    expect(acc.status()).toBe('recording');

    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:03.000Z',
        state: { state: 'idle', substate: 'idle' },
      }),
    );
    expect(acc.status()).toBe('frozen');
    expect(acc.frozenShot()).not.toBeNull();
  });

  it('freezes immediately when the brew is aborted (state leaves espresso early)', () => {
    const rig = buildRig();
    mount(rig);
    rig.setMachine(
      mkSnap({ state: { state: 'espresso', substate: 'preparingForShot' } }),
    );
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:01.000Z',
        state: { state: 'espresso', substate: 'pouring' },
        pressure: 6,
      }),
    );
    rig.setMachine(
      mkSnap({
        timestamp: '2026-05-22T08:00:02.000Z',
        state: { state: 'idle', substate: 'idle' },
      }),
    );
    expect(liveCtx().accumulator.status()).toBe('frozen');
    expect(liveCtx().accumulator.frozenShot()).not.toBeNull();
  });

  it('does not append frames while status is idle', () => {
    const rig = buildRig();
    mount(rig);
    rig.setMachine(
      mkSnap({ state: { state: 'idle', substate: 'idle' }, pressure: 5 }),
    );
    expect(liveCtx().accumulator.frameCount()).toBe(0);
  });

  it('stop() invokes the injected onStop side-effect', async () => {
    const rig = buildRig();
    mount(rig);
    await liveCtx().stop();
    expect(rig.onStop).toHaveBeenCalledTimes(1);
  });

  describe('steam session', () => {
    it('starts idle and stays idle while the machine is not in steam', () => {
      const rig = buildRig({ machine: mkSnap({ state: { state: 'idle', substate: 'idle' } }) });
      mount(rig);
      expect(liveCtx().operationSession.status()).toBe('idle');
      expect(liveCtx().operationSession.startedAtMs()).toBe(0);
    });

    it('flips to "active" when machine state enters steam and records the timestamp', () => {
      const rig = buildRig();
      mount(rig);
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('active');
      expect(liveCtx().operationSession.kind()).toBe('steam');
      expect(liveCtx().operationSession.startedAtMs()).toBe(
        Date.parse('2026-05-25T08:00:00.000Z'),
      );
    });

    it('returns to "idle" when machine leaves steam state', () => {
      const rig = buildRig();
      mount(rig);
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('active');
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:30.000Z',
          state: { state: 'idle', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('idle');
      expect(liveCtx().operationSession.startedAtMs()).toBe(0);
    });

    it('does not affect the espresso accumulator', () => {
      const rig = buildRig();
      mount(rig);
      rig.setMachine(
        mkSnap({ state: { state: 'steam', substate: 'idle' } }),
      );
      expect(liveCtx().accumulator.status()).toBe('idle');
      expect(liveCtx().accumulator.frameCount()).toBe(0);
    });

    it('phase tracks the steam → airPurge → idle firmware sequence', () => {
      // The DE1 runs an autonomous ~5 s wand purge after a steam stop. From
      // the skin's perspective: state enters 'steam' (phase: steaming) →
      // transitions to 'airPurge' (phase: purging, session still active) →
      // eventually 'idle' (session ends, phase idle). The gateway maps the
      // brief firmware 'puffing' substate to 'idle' under steam, so we
      // don't see it directly — but we're still in state=steam for the
      // whole window before the airPurge state, so no extra handling.
      const rig = buildRig();
      mount(rig);
      expect(liveCtx().operationSession.phase()).toBe('idle');

      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('active');
      expect(liveCtx().operationSession.phase()).toBe('steaming');

      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:25.000Z',
          state: { state: 'airPurge', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('active');
      expect(liveCtx().operationSession.phase()).toBe('purging');
      // startedAtMs should still be the steam-entry timestamp so the
      // TIME readout keeps counting from session start, not from
      // purge start.
      expect(liveCtx().operationSession.startedAtMs()).toBe(
        Date.parse('2026-05-25T08:00:00.000Z'),
      );

      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:30.000Z',
          state: { state: 'idle', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('idle');
      expect(liveCtx().operationSession.phase()).toBe('idle');
      expect(liveCtx().operationSession.startedAtMs()).toBe(0);
    });

    it('two-tap-stop path: steam → idle (no airPurge) ends the session immediately', () => {
      // In two-tap-stop mode the firmware parks in the puffing substate
      // until a second tap. If the user never taps and the machine
      // eventually goes idle without an airPurge transition, the session
      // should still end cleanly.
      const rig = buildRig();
      mount(rig);
      rig.setMachine(
        mkSnap({ state: { state: 'steam', substate: 'idle' } }),
      );
      expect(liveCtx().operationSession.phase()).toBe('steaming');
      rig.setMachine(
        mkSnap({ state: { state: 'idle', substate: 'idle' } }),
      );
      expect(liveCtx().operationSession.status()).toBe('idle');
      expect(liveCtx().operationSession.phase()).toBe('idle');
    });
  });

  describe('water + flush sessions', () => {
    const baseMachineSettings: MachineSettingsSnapshot = {
      fan: 50,
      usb: 'disable',
      flushTemp: 90,
      flushTimeout: 5,
      flushFlow: 4,
      hotWaterFlow: 4,
      steamFlow: 1.0,
      tankTemp: 25,
      steamPurgeMode: 0,
    };

    it('hot water flips to active with kind="water" and no purge phase', () => {
      const rig = buildRig();
      mount(rig);
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-27T08:00:00.000Z',
          state: { state: 'hotWater', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('active');
      expect(liveCtx().operationSession.kind()).toBe('water');
      expect(liveCtx().operationSession.phase()).toBe('idle');
      expect(liveCtx().operationSession.startedAtMs()).toBe(
        Date.parse('2026-05-27T08:00:00.000Z'),
      );
    });

    it('flush flips to active with kind="flush"', () => {
      const rig = buildRig();
      mount(rig);
      rig.setMachine(mkSnap({ state: { state: 'flush', substate: 'idle' } }));
      expect(liveCtx().operationSession.status()).toBe('active');
      expect(liveCtx().operationSession.kind()).toBe('flush');
    });

    it('returns to idle with kind=null when the machine leaves the operation', () => {
      const rig = buildRig();
      mount(rig);
      rig.setMachine(mkSnap({ state: { state: 'hotWater', substate: 'idle' } }));
      expect(liveCtx().operationSession.kind()).toBe('water');
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-27T08:00:30.000Z',
          state: { state: 'idle', substate: 'idle' },
        }),
      );
      expect(liveCtx().operationSession.status()).toBe('idle');
      expect(liveCtx().operationSession.kind()).toBeNull();
      expect(liveCtx().operationSession.startedAtMs()).toBe(0);
    });

    it('fetches machine-settings on hot-water start (for the flow slider)', async () => {
      const rig = buildRig({ machineSettings: baseMachineSettings });
      mount(rig);
      rig.setMachine(mkSnap({ state: { state: 'hotWater', substate: 'idle' } }));
      expect(rig.onFetchMachineSettings).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(liveCtx().machineSettings()?.hotWaterFlow).toBe(4),
      );
    });

    it('fetches machine-settings on flush start (for flushTimeout + flow)', async () => {
      const rig = buildRig({ machineSettings: baseMachineSettings });
      mount(rig);
      rig.setMachine(mkSnap({ state: { state: 'flush', substate: 'idle' } }));
      expect(rig.onFetchMachineSettings).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(liveCtx().machineSettings()?.flushTimeout).toBe(5),
      );
    });

    it('does not write shotSettings when a non-steam operation ends (no steam restore)', () => {
      const shotSettings: ShotSettingsSnapshot = {
        steamSetting: 0,
        targetSteamTemp: 145,
        targetSteamDuration: 30,
        targetHotWaterTemp: 90,
        targetHotWaterVolume: 150,
        targetHotWaterDuration: 30,
        targetShotVolume: 36,
        groupTemp: 92,
      };
      const rig = buildRig({ shotSettings });
      mount(rig);
      rig.setMachine(mkSnap({ state: { state: 'hotWater', substate: 'idle' } }));
      const before = rig.onUpdateShotSettings.mock.calls.length;
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-27T08:00:30.000Z',
          state: { state: 'idle', substate: 'idle' },
        }),
      );
      expect(rig.onUpdateShotSettings.mock.calls.length).toBe(before);
    });
  });

  describe('extendSteam', () => {
    const baseSettings: ShotSettingsSnapshot = {
      steamSetting: 1,
      targetSteamTemp: 145,
      targetSteamDuration: 30,
      targetHotWaterTemp: 90,
      targetHotWaterVolume: 100,
      targetHotWaterDuration: 30,
      targetShotVolume: 36,
      groupTemp: 92,
    };

    it('reads current shotSettings, adds delta, calls onUpdateShotSettings', async () => {
      const rig = buildRig({ shotSettings: baseSettings });
      mount(rig);
      await liveCtx().extendSteam(10);
      expect(rig.onUpdateShotSettings).toHaveBeenCalledWith({
        ...baseSettings,
        targetSteamDuration: 40,
      });
    });

    it('is a no-op when no shotSettings have arrived yet', async () => {
      const rig = buildRig({ shotSettings: null });
      mount(rig);
      await liveCtx().extendSteam(10);
      expect(rig.onUpdateShotSettings).not.toHaveBeenCalled();
    });

    it('clamps the new duration at 0 (never negative)', async () => {
      const rig = buildRig({
        shotSettings: { ...baseSettings, targetSteamDuration: 5 },
      });
      mount(rig);
      await liveCtx().extendSteam(-100);
      expect(rig.onUpdateShotSettings).toHaveBeenCalledWith({
        ...baseSettings,
        targetSteamDuration: 0,
      });
    });

    describe('session-only semantics', () => {
      it('restores the original targetSteamDuration when steam ends after an extend', async () => {
        const rig = buildRig({ shotSettings: baseSettings });
        mount(rig);

        // Steam starts — snapshot the original (30 s) for later restore.
        rig.setMachine(
          mkSnap({
            timestamp: '2026-05-25T08:00:00.000Z',
            state: { state: 'steam', substate: 'idle' },
          }),
        );

        // User bumps it to 40 mid-session.
        await liveCtx().extendSteam(10);
        rig.setShotSettings({ ...baseSettings, targetSteamDuration: 40 });
        expect(rig.onUpdateShotSettings).toHaveBeenLastCalledWith({
          ...baseSettings,
          targetSteamDuration: 40,
        });

        // Steam ends — the saved firmware default should be put back.
        rig.setMachine(
          mkSnap({
            timestamp: '2026-05-25T08:00:30.000Z',
            state: { state: 'idle', substate: 'idle' },
          }),
        );
        expect(rig.onUpdateShotSettings).toHaveBeenLastCalledWith({
          ...baseSettings,
          targetSteamDuration: 30, // restored
        });
      });

      it('does not write on session-end when the duration was not extended', () => {
        const rig = buildRig({ shotSettings: baseSettings });
        mount(rig);
        rig.setMachine(
          mkSnap({ state: { state: 'steam', substate: 'idle' } }),
        );
        const callsBeforeEnd = rig.onUpdateShotSettings.mock.calls.length;
        rig.setMachine(
          mkSnap({
            timestamp: '2026-05-25T08:00:30.000Z',
            state: { state: 'idle', substate: 'idle' },
          }),
        );
        // No new POST — nothing to restore.
        expect(rig.onUpdateShotSettings.mock.calls.length).toBe(callsBeforeEnd);
      });

      it('restoration uses the duration captured at steam-session start, not whichever value happens to be live at session end', async () => {
        const rig = buildRig({ shotSettings: baseSettings });
        mount(rig);
        // Steam starts when saved duration is 30.
        rig.setMachine(
          mkSnap({ state: { state: 'steam', substate: 'idle' } }),
        );

        // Multiple extends during the session.
        await liveCtx().extendSteam(10);
        rig.setShotSettings({ ...baseSettings, targetSteamDuration: 40 });
        await liveCtx().extendSteam(10);
        rig.setShotSettings({ ...baseSettings, targetSteamDuration: 50 });

        // End the session.
        rig.setMachine(
          mkSnap({
            timestamp: '2026-05-25T08:00:30.000Z',
            state: { state: 'idle', substate: 'idle' },
          }),
        );
        expect(rig.onUpdateShotSettings).toHaveBeenLastCalledWith({
          ...baseSettings,
          targetSteamDuration: 30, // captured at start, not the 50 at end
        });
      });
    });
  });

  describe('machineSettings (fetched on steam start)', () => {
    const baseMachine: MachineSettingsSnapshot = {
      fan: 50,
      usb: 'disable',
      flushTemp: 90,
      flushTimeout: 5,
      flushFlow: 4,
      hotWaterFlow: 4,
      steamFlow: 1.0,
      tankTemp: 25,
      steamPurgeMode: 0,
    };

    it('starts as null', () => {
      const rig = buildRig();
      mount(rig);
      expect(liveCtx().machineSettings()).toBeNull();
    });

    it('fetches machine settings when state enters steam', async () => {
      const rig = buildRig({ machineSettings: baseMachine });
      mount(rig);
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:00.000Z',
          state: { state: 'steam', substate: 'idle' },
        }),
      );
      expect(rig.onFetchMachineSettings).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(liveCtx().machineSettings()?.steamFlow).toBe(1.0),
      );
    });

    it('does not re-fetch on subsequent steam frames (only on session start)', async () => {
      const rig = buildRig({ machineSettings: baseMachine });
      mount(rig);
      rig.setMachine(
        mkSnap({ state: { state: 'steam', substate: 'idle' } }),
      );
      await waitFor(() => liveCtx().machineSettings() !== null);
      rig.setMachine(
        mkSnap({
          timestamp: '2026-05-25T08:00:05.000Z',
          state: { state: 'steam', substate: 'idle' },
          steamTemperature: 144,
        }),
      );
      expect(rig.onFetchMachineSettings).toHaveBeenCalledTimes(1);
    });

    it('updateMachineSettings optimistically merges + calls the injected updater', async () => {
      const rig = buildRig({ machineSettings: baseMachine });
      mount(rig);
      rig.setMachine(
        mkSnap({ state: { state: 'steam', substate: 'idle' } }),
      );
      await waitFor(() => liveCtx().machineSettings() !== null);

      await liveCtx().updateMachineSettings({ steamFlow: 1.6 });
      expect(rig.onUpdateMachineSettings).toHaveBeenCalledWith({ steamFlow: 1.6 });
      // Optimistic merge: the cached snapshot reflects the new value
      // immediately (machineSettings has no WS stream to refresh it).
      expect(liveCtx().machineSettings()?.steamFlow).toBe(1.6);
      // Other fields untouched.
      expect(liveCtx().machineSettings()?.fan).toBe(50);
    });

    it('rolls the optimistic merge back when the gateway update rejects', async () => {
      const rig = buildRig({ machineSettings: baseMachine });
      rig.onUpdateMachineSettings.mockRejectedValueOnce(new Error('500'));
      mount(rig);
      rig.setMachine(
        mkSnap({ state: { state: 'steam', substate: 'idle' } }),
      );
      await waitFor(() => liveCtx().machineSettings() !== null);

      await expect(
        liveCtx().updateMachineSettings({ steamFlow: 1.9 }),
      ).rejects.toThrow();
      // Rollback restores the original value.
      expect(liveCtx().machineSettings()?.steamFlow).toBe(1.0);
    });
  });
});
