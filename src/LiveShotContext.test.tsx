import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { LiveShotProvider, useLiveShot } from './LiveShotContext';
import type { MachineSnapshot, ScaleMessage } from './snapshot';
import type { WorkflowSnapshot } from './api';
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
  setMachine: (s: MachineSnapshot | null) => void;
  setScale: (s: ScaleMessage | null) => void;
  fetchWorkflow: ReturnType<typeof vi.fn<() => Promise<WorkflowSnapshot>>>;
  onStop: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

const buildRig = (initial: {
  machine?: MachineSnapshot | null;
  scale?: ScaleMessage | null;
  workflow?: WorkflowSnapshot;
} = {}): Rig => {
  const [machine, setMachine] = createSignal<MachineSnapshot | null>(initial.machine ?? null);
  const [scale, setScale] = createSignal<ScaleMessage | null>(initial.scale ?? null);
  const status = createSignal<WsStatus>('open')[0];
  return {
    machineStream: { latest: machine, status },
    scaleStream: { latest: scale, status },
    setMachine,
    setScale,
    fetchWorkflow: vi
      .fn<() => Promise<WorkflowSnapshot>>()
      .mockResolvedValue(initial.workflow ?? { context: {} }),
    onStop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
};

const mount = (rig: Rig) =>
  render(() => (
    <LiveShotProvider
      machineStream={rig.machineStream}
      scaleStream={rig.scaleStream}
      fetchWorkflow={rig.fetchWorkflow}
      onStop={rig.onStop}
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
});
