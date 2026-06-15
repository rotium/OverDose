import { describe, expect, it } from 'vitest';
import { buildShotChartData, seriesShow } from './ShotMiniChart';
import { DEFAULT_TRACE_VISIBILITY } from '../prefs';
import type { GatewayShotMeasurement, GatewayShotRecord } from '../api';

const measure = (
  over: Partial<GatewayShotMeasurement['machine']> & {
    weight?: number;
    weightFlow?: number;
  } = {},
): GatewayShotMeasurement => ({
  machine: {
    timestamp: over.timestamp ?? '2026-06-14T09:00:00.000Z',
    flow: over.flow ?? 0,
    pressure: over.pressure ?? 0,
    mixTemperature: over.mixTemperature ?? 90,
    groupTemperature: 0,
    targetFlow: over.targetFlow,
    targetPressure: over.targetPressure,
    targetMixTemperature: over.targetMixTemperature,
  },
  scale: over.weight != null ? { weight: over.weight, weightFlow: over.weightFlow } : undefined,
});

const rec = (measurements: GatewayShotMeasurement[]): GatewayShotRecord =>
  ({ id: 's', timestamp: '', measurements }) as GatewayShotRecord;

describe('buildShotChartData', () => {
  it('returns 9 aligned arrays (time + 5 solid + 3 dashed targets)', () => {
    const data = buildShotChartData(rec([measure()]));
    expect(data).toHaveLength(9);
  });

  it('returns 9 empty arrays for a record with no measurements', () => {
    const data = buildShotChartData(rec([]));
    expect(data).toHaveLength(9);
    expect(data.every((a) => (a as number[]).length === 0)).toBe(true);
  });

  it('extracts target setpoints with the same transforms as their primary', () => {
    const data = buildShotChartData(
      rec([
        measure({
          pressure: 9,
          flow: 2,
          mixTemperature: 93,
          targetPressure: 8.5,
          targetFlow: 2.2,
          targetMixTemperature: 92,
        }),
      ]),
    ) as number[][];
    // idx 6 = target pressure (raw), 7 = target flow (raw), 8 = target mix (÷10)
    expect(data[6]![0]).toBe(8.5);
    expect(data[7]![0]).toBeCloseTo(2.2);
    expect(data[8]![0]).toBeCloseTo(9.2); // 92 ÷ 10
  });

  it('emits NaN for missing target setpoints (older records) so the line gaps', () => {
    const data = buildShotChartData(rec([measure({ pressure: 9 })])) as number[][];
    expect(Number.isNaN(data[6]![0]!)).toBe(true);
    expect(Number.isNaN(data[7]![0]!)).toBe(true);
    expect(Number.isNaN(data[8]![0]!)).toBe(true);
  });

  it('emits NaN weight when a frame had no scale', () => {
    const data = buildShotChartData(rec([measure({ pressure: 9 })])) as number[][];
    expect(Number.isNaN(data[3]![0]!)).toBe(true);
  });
});

describe('seriesShow', () => {
  it('shows every series (solid + targets) by default', () => {
    const s = seriesShow(DEFAULT_TRACE_VISIBILITY);
    for (let i = 1; i <= 8; i++) expect(s[i]).toBe(true);
  });

  it('hides all dashed targets when the targets master is off', () => {
    const s = seriesShow({ ...DEFAULT_TRACE_VISIBILITY, targets: false });
    // Solids stay on…
    expect(s[1]).toBe(true);
    expect(s[2]).toBe(true);
    expect(s[4]).toBe(true);
    // …targets (6 pressure, 7 flow, 8 mix) go off.
    expect(s[6]).toBe(false);
    expect(s[7]).toBe(false);
    expect(s[8]).toBe(false);
  });

  it('hides a target when its primary trace is hidden', () => {
    const s = seriesShow({ ...DEFAULT_TRACE_VISIBILITY, pressure: false });
    expect(s[1]).toBe(false); // primary pressure
    expect(s[6]).toBe(false); // its target follows, even with targets master on
    expect(s[7]).toBe(true); // flow target unaffected
  });
});
