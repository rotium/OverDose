import { describe, expect, it } from 'vitest';
import type {
  GatewayShotMeasurement,
  GatewayShotRecord,
  GatewayShotSummary,
  WorkflowSnapshot,
} from './api';
import {
  deriveShotStats,
  shotDoseG,
  shotDurationSec,
  shotHeadline,
  shotPeakFlowMlS,
  shotPeakPressureBar,
  shotSubtitle,
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
  });
});
