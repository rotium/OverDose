import { describe, expect, it } from 'vitest';
import type {
  GatewayShotMeasurement,
  GatewayShotRecord,
  GatewayShotSummary,
  WorkflowSnapshot,
} from './api';
import {
  deriveShotStats,
  shotCountedVolumeMl,
  shotDoseG,
  shotDurationSec,
  shotHeadline,
  shotPeakFlowMlS,
  shotPeakPressureBar,
  shotSubtitle,
  shotReadoutAt,
  shotTargetVolumeMl,
  shotTargetYieldG,
  shotVolumeMl,
  shotYieldG,
} from './shotStats';

const meas = (
  tSec: number,
  over: Partial<GatewayShotMeasurement['machine']> = {},
  scale?: { weight: number; weightFlow?: number },
): GatewayShotMeasurement => ({
  machine: {
    timestamp: new Date(Date.UTC(2026, 4, 27, 8, 0, tSec)).toISOString(),
    flow: 0,
    pressure: 0,
    mixTemperature: 92,
    groupTemperature: 92,
    ...over,
  },
  scale,
});

const summary = (
  workflow?: WorkflowSnapshot,
  annotations?: GatewayShotSummary['annotations'],
): GatewayShotSummary => ({
  id: 'shot-1',
  timestamp: '2026-05-27T08:00:00.000Z',
  workflow,
  annotations,
});

const record = (
  measurements: GatewayShotMeasurement[],
  workflow?: WorkflowSnapshot,
  annotations?: GatewayShotSummary['annotations'],
): GatewayShotRecord => ({
  ...summary(workflow, annotations),
  measurements,
});

describe('shotHeadline', () => {
  it('prefers profile title, then workflow name, then coffee name, then "Shot"', () => {
    expect(
      shotHeadline(summary({ profile: { title: 'C+' }, name: 'Cappuccino' })),
    ).toBe('C+');
    expect(shotHeadline(summary({ name: 'Cappuccino' }))).toBe('Cappuccino');
    expect(
      shotHeadline(summary({ context: { coffeeName: 'Brazil' } })),
    ).toBe('Brazil');
    expect(shotHeadline(summary())).toBe('Shot');
    expect(shotHeadline(null)).toBe('Shot');
  });
});

describe('shotSubtitle', () => {
  it('combines recipe + bean when the headline is the profile', () => {
    expect(
      shotSubtitle(
        summary({
          profile: { title: 'C+' },
          name: 'Cappuccino',
          context: { coffeeName: 'Brazil' },
        }),
      ),
    ).toBe('Cappuccino · Brazil');
  });

  it('is empty when the headline is already the recipe name', () => {
    expect(shotSubtitle(summary({ name: 'Cappuccino' }))).toBe('');
  });
});

describe('dose / yield / targets', () => {
  it('dose prefers measured actual, else the target', () => {
    expect(
      shotDoseG(summary({ context: { targetDoseWeight: 18 } })),
    ).toBe(18);
    expect(
      shotDoseG(
        summary({ context: { targetDoseWeight: 18 } }, { actualDoseWeight: 18.3 }),
      ),
    ).toBe(18.3);
  });

  it('yield is the MEASURED value (annotations, else last scale weight) — not the target', () => {
    const full = record([
      meas(0, { flow: 1 }, { weight: 10 }),
      meas(1, { flow: 2 }, { weight: 35.6 }),
    ]);
    // No annotations → falls to last scale weight.
    expect(
      shotYieldG(summary({ context: { targetYield: 36 } }), full),
    ).toBe(35.6);
    // Annotations win when present.
    expect(
      shotYieldG(summary(undefined, { actualYield: 35.9 }), full),
    ).toBe(35.9);
    // No measured value at all → null (does NOT fall back to target).
    expect(shotYieldG(summary({ context: { targetYield: 36 } }), null)).toBeNull();
  });

  it('targetYield / targetVolume come from the workflow', () => {
    expect(
      shotTargetYieldG(summary({ context: { targetYield: 36 } })),
    ).toBe(36);
    expect(
      shotTargetVolumeMl(summary({ profile: { title: 'p', target_volume: 50 } })),
    ).toBe(50);
    expect(shotTargetYieldG(summary())).toBeNull();
    expect(shotTargetVolumeMl(summary())).toBeNull();
  });
});

describe('measurement-derived stats', () => {
  const full = record([
    meas(0, { flow: 0.5, pressure: 2 }),
    meas(1, { flow: 2.5, pressure: 9.1 }),
    meas(2, { flow: 2.0, pressure: 8.4 }),
    meas(3, { flow: 1.5, pressure: 6.0 }),
  ]);

  it('duration is last − first timestamp (s)', () => {
    expect(shotDurationSec(full)).toBe(3);
    expect(shotDurationSec(record([meas(0)]))).toBeNull(); // <2 frames
    expect(shotDurationSec(null)).toBeNull();
  });

  it('peak pressure + peak flow are the maxima', () => {
    expect(shotPeakPressureBar(full)).toBe(9.1);
    expect(shotPeakFlowMlS(full)).toBe(2.5);
    expect(shotPeakPressureBar(record([]))).toBeNull();
  });

  it('volume integrates flow left-Riemann (flowᵢ × Δt)', () => {
    // Δt = 1s each. vol = 2.5 + 2.0 + 1.5 = 6.0 (first frame contributes 0).
    expect(shotVolumeMl(full)).toBeCloseTo(6);
    expect(shotVolumeMl(record([meas(0, { flow: 2 })]))).toBeNull(); // <2 frames
  });

  it('counted volume integrates only frames at/after count-start', () => {
    // Frames 0,0,1,1; Δt = 1s. Total = 1+2+3 = 6 (first contributes 0).
    // count-start 1 drops the frame-0 sample (i=1) → 2 + 3 = 5.
    const f = record([
      meas(0, { flow: 9, profileFrame: 0 }),
      meas(1, { flow: 1, profileFrame: 0 }),
      meas(2, { flow: 2, profileFrame: 1 }),
      meas(3, { flow: 3, profileFrame: 1 }),
    ]);
    expect(shotCountedVolumeMl(f, 1)).toBeCloseTo(5);
    // count-start 0 equals the full dispensed volume.
    expect(shotCountedVolumeMl(f, 0)).toBeCloseTo(shotVolumeMl(f)!);
    // Null when samples carry no frame index (can't be windowed).
    expect(
      shotCountedVolumeMl(record([meas(0, { flow: 1 }), meas(1, { flow: 2 })]), 1),
    ).toBeNull();
  });

  it('counted volume excludes the post-stop ramp-down (substate gate)', () => {
    // 1s steps. Three pouring samples, then a pouringDone ramp-down sample
    // that still has flow — it must NOT count toward the stop volume.
    const f = record([
      meas(0, { flow: 0, profileFrame: 2, state: { substate: 'pouring' } }),
      meas(1, { flow: 2, profileFrame: 2, state: { substate: 'pouring' } }),
      meas(2, { flow: 2, profileFrame: 2, state: { substate: 'pouring' } }),
      meas(3, { flow: 2, profileFrame: 2, state: { substate: 'pouringDone' } }),
    ]);
    expect(shotCountedVolumeMl(f, 0)).toBeCloseTo(4); // 2 + 2; ramp-down excluded
  });
});

describe('deriveShotStats', () => {
  it('assembles everything from summary + full', () => {
    const wf: WorkflowSnapshot = {
      name: 'Cappuccino',
      profile: { title: 'Best Practice C+', target_volume: 50 },
      context: { targetDoseWeight: 18, targetYield: 36, coffeeName: 'Brazil' },
    };
    const full = record(
      [
        meas(0, { flow: 0.5, pressure: 2 }, { weight: 0 }),
        meas(1, { flow: 2.5, pressure: 9.1 }, { weight: 20 }),
        meas(2, { flow: 2.0, pressure: 8.0 }, { weight: 35.8 }),
      ],
      wf,
    );
    const s = deriveShotStats(record([], wf), full);
    // summary fields from the empty-measurements record (carries workflow)
    expect(s.headline).toBe('Best Practice C+');
    expect(s.subtitle).toBe('Cappuccino · Brazil');
    expect(s.doseG).toBe(18);
    expect(s.targetYieldG).toBe(36);
    expect(s.targetVolumeMl).toBe(50);
    // measurement fields from `full`
    expect(s.yieldG).toBe(35.8);
    expect(s.durationSec).toBe(2);
    expect(s.peakPressureBar).toBe(9.1);
    expect(s.peakFlowMlS).toBe(2.5);
    expect(s.volumeMl).toBeCloseTo(4.5); // 2.5 + 2.0
    // No count-start on this profile → counted-volume fields stay null.
    expect(s.volumeCountStart).toBeNull();
    expect(s.countedVolumeMl).toBeNull();
  });

  it('exposes counted volume only when the profile sets count-start > 0', () => {
    const mez = [
      meas(0, { flow: 9, profileFrame: 0 }),
      meas(1, { flow: 1, profileFrame: 0 }),
      meas(2, { flow: 2, profileFrame: 1 }),
    ];
    const s0 = deriveShotStats(
      record([], { profile: { title: 'p', target_volume_count_start: 0 } }),
      record(mez),
    );
    expect(s0.volumeCountStart).toBeNull();
    expect(s0.countedVolumeMl).toBeNull();

    const s1 = deriveShotStats(
      record([], { profile: { title: 'p', target_volume_count_start: 1 } }),
      record(mez),
    );
    expect(s1.volumeCountStart).toBe(1);
    expect(s1.countedVolumeMl).toBeCloseTo(2); // only the frame-1 sample (i=2)
  });
});

describe('shotReadoutAt', () => {
  const rec = record(
    [
      meas(0, { pressure: 2, flow: 4, mixTemperature: 90, profileFrame: 0 }, { weight: 0 }),
      meas(5, { pressure: 9, flow: 2, mixTemperature: 93, profileFrame: 1 }, { weight: 18 }),
    ],
    { profile: { title: 'P', steps: [{ name: 'Preinfusion' }, { name: 'Pour' }] } },
  );

  it('returns real-unit values + step name at the sample index', () => {
    const r = shotReadoutAt(rec, 1)!;
    expect(r.timeSec).toBeCloseTo(5);
    expect(r.pressure).toBe(9);
    expect(r.flow).toBe(2);
    expect(r.mixTemp).toBe(93);
    expect(r.weight).toBe(18);
    expect(r.stepName).toBe('Pour');
  });

  it('returns null for a null or out-of-range index', () => {
    expect(shotReadoutAt(rec, null)).toBeNull();
    expect(shotReadoutAt(rec, -1)).toBeNull();
    expect(shotReadoutAt(rec, 5)).toBeNull();
  });
});
