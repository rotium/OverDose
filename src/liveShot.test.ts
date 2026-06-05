import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import {
  createLiveShotAccumulator,
  LIVE_SHOT_BUFFER_CAPACITY,
  type LiveShotFrame,
} from './liveShot';
import type { WorkflowContextSnapshot, WorkflowSnapshot } from './api';

const frame = (over: Partial<LiveShotFrame> = {}): LiveShotFrame => ({
  tMs: 0,
  pressure: 0,
  flow: 0,
  weightFlow: NaN,
  weight: NaN,
  mixTemperature: 92,
  targetPressure: 0,
  targetFlow: 0,
  targetMixTemperature: 92,
  machineTimestamp: '2026-05-22T08:00:00.000Z',
  substate: 'idle',
  profileFrame: 0,
  ...over,
});

const wf = (context?: WorkflowContextSnapshot, profile?: WorkflowSnapshot['profile']): WorkflowSnapshot => ({
  ...(context ? { context } : {}),
  ...(profile ? { profile } : {}),
});

/**
 * createLiveShotAccumulator uses createSignal under the hood. Solid wants
 * those to live inside an owner — wrapping every test in `createRoot` keeps
 * signal disposal clean and silences "computations created outside" warnings.
 */
const inRoot = (body: () => void) =>
  createRoot((dispose) => {
    try {
      body();
    } finally {
      dispose();
    }
  });

describe('LiveShotAccumulator', () => {
  describe('lifecycle', () => {
    it('starts in idle state with empty buffers', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        expect(acc.status()).toBe('idle');
        expect(acc.frameCount()).toBe(0);
        expect(acc.readouts()).toBeNull();
        expect(acc.frozenShot()).toBeNull();
        expect(acc.targetYieldG()).toBe(0);
        expect(acc.buffers.cursor).toBe(0);
      });
    });

    it('start() transitions to recording and captures targetYield from workflow context', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        const ctx: WorkflowContextSnapshot = { targetYield: 36, coffeeName: 'Brazil' };
        acc.start(wf(ctx));
        expect(acc.status()).toBe('recording');
        expect(acc.targetYieldG()).toBe(36);
      });
    });

    it('start() captures profile (title + steps) so the live view can render names', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(
          wf({ targetYield: 36 }, {
            title: 'Gentle and Sweet',
            steps: [{ name: 'ramp up' }, { name: 'decline' }],
          }),
        );
        expect(acc.currentProfile()?.title).toBe('Gentle and Sweet');
        expect(acc.currentProfile()?.steps?.[1]?.name).toBe('decline');
      });
    });

    it('start() with null context yields zero target', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        expect(acc.targetYieldG()).toBe(0);
      });
    });

    it('freeze() transitions to frozen and exposes a measurements snapshot', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(wf({ targetYield: 36 }));
        acc.append(frame({ tMs: 0, pressure: 1, flow: 0.2, weight: 0, mixTemperature: 90 }));
        acc.append(frame({ tMs: 100, pressure: 6, flow: 2, weight: 5, mixTemperature: 92 }));
        acc.append(frame({ tMs: 200, pressure: 8, flow: 2.5, weight: 12, mixTemperature: 92.5 }));

        acc.freeze();

        expect(acc.status()).toBe('frozen');
        const frozen = acc.frozenShot()!;
        expect(frozen).not.toBeNull();
        expect(frozen.measurements).toHaveLength(3);
        expect(frozen.measurements[0]!.machine.pressure).toBe(1);
        expect(frozen.measurements[2]!.scale).toEqual({ weight: 12 });
        expect(frozen.workflow?.context).toEqual({ targetYield: 36 });
      });
    });

    it('freeze() omits scale block when weight was NaN (no scale connected)', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ tMs: 0, weight: NaN }));
        acc.freeze();
        const m = acc.frozenShot()!.measurements[0]!;
        expect(m.scale).toBeUndefined();
      });
    });

    it('reset() returns to idle and clears frozen state', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(wf({ targetYield: 36 }, { title: 'Gentle' }));
        acc.append(frame({ tMs: 0, pressure: 6 }));
        acc.freeze();
        expect(acc.frozenShot()).not.toBeNull();

        acc.reset();
        expect(acc.status()).toBe('idle');
        expect(acc.frameCount()).toBe(0);
        expect(acc.readouts()).toBeNull();
        expect(acc.frozenShot()).toBeNull();
        expect(acc.targetYieldG()).toBe(0);
        expect(acc.currentProfile()).toBeNull();
      });
    });

    it('start() after a previous shot reuses the same buffers with cursor reset', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        const buffersBefore = acc.buffers;

        acc.start(null);
        acc.append(frame({ tMs: 0, pressure: 5 }));
        acc.append(frame({ tMs: 100, pressure: 7 }));
        acc.freeze();

        acc.start(null);
        // Cursor reset, buffer object identity preserved.
        expect(acc.buffers).toBe(buffersBefore);
        expect(acc.buffers.cursor).toBe(0);
        expect(acc.frameCount()).toBe(0);
      });
    });

    it('freeze() while idle is a no-op (no spurious frozen state)', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.freeze();
        expect(acc.status()).toBe('idle');
        expect(acc.frozenShot()).toBeNull();
      });
    });
  });

  describe('append (hot path)', () => {
    it('writes frames into the typed buffers and increments the cursor', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ tMs: 0, pressure: 1, flow: 0.2, weight: 0 }));
        acc.append(frame({ tMs: 100, pressure: 6, flow: 2, weight: 5 }));

        expect(acc.buffers.cursor).toBe(2);
        expect(acc.buffers.tMs[0]).toBe(0);
        expect(acc.buffers.tMs[1]).toBe(100);
        expect(acc.buffers.pressure[1]).toBe(6);
        expect(acc.buffers.weight[1]).toBe(5);
        expect(acc.frameCount()).toBe(2);
      });
    });

    it('writes profileFrame into a parallel Int32 buffer so the chart can find step transitions', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ tMs: 0, profileFrame: 0 }));
        acc.append(frame({ tMs: 100, profileFrame: 0 }));
        acc.append(frame({ tMs: 200, profileFrame: 1 }));   // boundary
        acc.append(frame({ tMs: 300, profileFrame: 1 }));
        acc.append(frame({ tMs: 400, profileFrame: 2 }));   // boundary
        const pf = acc.buffers.profileFrame;
        expect(pf[0]).toBe(0);
        expect(pf[2]).toBe(1);
        expect(pf[4]).toBe(2);
        // Sanity check: the buffer is an Int32Array (no float drift on indexing).
        expect(pf).toBeInstanceOf(Int32Array);
      });
    });

    it('exposes the most recent values + elapsed seconds via readouts()', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(
          frame({
            tMs: 12_500,
            pressure: 7.5,
            flow: 1.8,
            weight: 22,
            mixTemperature: 91.4,
            substate: 'pouring',
          }),
        );
        const r = acc.readouts()!;
        expect(r.pressure).toBe(7.5);
        expect(r.flow).toBe(1.8);
        expect(r.weight).toBe(22);
        expect(r.mixTemperature).toBe(91.4);
        expect(r.elapsedSec).toBeCloseTo(12.5);
        expect(r.substate).toBe('pouring');
      });
    });

    it('integrates flow into volume (mL) — left-Riemann, matching the gateway', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        // First frame contributes 0 (no previous sample to integrate against).
        acc.append(frame({ tMs: 0, flow: 2 }));
        expect(acc.readouts()!.volumeMl).toBeCloseTo(0);
        // +1s at 2 mL/s → 2 mL.
        acc.append(frame({ tMs: 1000, flow: 2 }));
        expect(acc.readouts()!.volumeMl).toBeCloseTo(2);
        // +0.5s at 4 mL/s → +2 mL → 4 mL total. Integration uses the
        // *current* frame's flow over the elapsed since the last sample.
        acc.append(frame({ tMs: 1500, flow: 4 }));
        expect(acc.readouts()!.volumeMl).toBeCloseTo(4);
      });
    });

    it('resets accumulated volume between shots', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ tMs: 0, flow: 2 }));
        acc.append(frame({ tMs: 1000, flow: 2 }));
        expect(acc.readouts()!.volumeMl).toBeCloseTo(2);
        // New shot → volume starts from zero again.
        acc.start(null);
        acc.append(frame({ tMs: 0, flow: 3 }));
        acc.append(frame({ tMs: 1000, flow: 3 }));
        expect(acc.readouts()!.volumeMl).toBeCloseTo(3);
      });
    });

    it('counted volume freezes when pouring ends; total keeps the ramp-down', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        // No count_start → counts from frame 0; isolate the substate gate.
        acc.start(wf(undefined, { title: 'p' }));
        acc.append(frame({ tMs: 0, flow: 0, substate: 'pouring', profileFrame: 2 }));
        // 2 × 1s pouring → +2 mL each to both total and counted.
        acc.append(frame({ tMs: 1000, flow: 2, substate: 'pouring', profileFrame: 2 }));
        acc.append(frame({ tMs: 2000, flow: 2, substate: 'pouring', profileFrame: 2 }));
        // Pump ramp-down after the stop: still flowing, but substate is
        // pouringDone → counts to total only, NOT to counted.
        acc.append(frame({ tMs: 3000, flow: 2, substate: 'pouringDone', profileFrame: 2 }));
        const r = acc.readouts()!;
        expect(r.volumeMl).toBeCloseTo(6); // 2 + 2 + 2
        expect(r.countedVolumeMl).toBeCloseTo(4); // ramp-down (last 2 mL) excluded
      });
    });

    it('drops frames silently once buffer capacity is exhausted (no allocation, no throw)', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        // Fill to capacity
        for (let i = 0; i < LIVE_SHOT_BUFFER_CAPACITY; i++) {
          acc.append(frame({ tMs: i, pressure: 1 }));
        }
        expect(acc.buffers.cursor).toBe(LIVE_SHOT_BUFFER_CAPACITY);
        // One more — should not throw, cursor unchanged
        acc.append(frame({ tMs: LIVE_SHOT_BUFFER_CAPACITY, pressure: 9 }));
        expect(acc.buffers.cursor).toBe(LIVE_SHOT_BUFFER_CAPACITY);
        expect(acc.frameCount()).toBe(LIVE_SHOT_BUFFER_CAPACITY);
      });
    });
  });
});
