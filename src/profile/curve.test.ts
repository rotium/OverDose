import { describe, expect, it } from 'vitest';
import {
  buildProfileCurve,
  maxPressure,
  maxFlow,
  maxTemperature,
} from './curve';

describe('buildProfileCurve', () => {
  it('returns an empty curve for non-array input', () => {
    expect(buildProfileCurve(undefined).empty).toBe(true);
    expect(buildProfileCurve(null).empty).toBe(true);
    expect(buildProfileCurve('not an array').empty).toBe(true);
    expect(buildProfileCurve({ foo: 'bar' }).empty).toBe(true);
  });

  it('returns an empty curve when the array contains only invalid steps', () => {
    const curve = buildProfileCurve([null, 'string', { seconds: 0 }, { seconds: -1 }]);
    expect(curve.empty).toBe(true);
    expect(curve.durationSec).toBe(0);
  });

  it('parses a single pressure-controlled step into one pressure run', () => {
    const curve = buildProfileCurve([
      {
        name: 'hold',
        pump: 'pressure',
        transition: 'fast',
        seconds: 10,
        pressure: 9,
      },
    ]);
    expect(curve.empty).toBe(false);
    expect(curve.durationSec).toBe(10);
    expect(curve.pressureRuns).toHaveLength(1);
    expect(curve.pressureRuns[0]).toEqual([
      { t: 0, v: 9 },
      { t: 10, v: 9 },
    ]);
    expect(curve.flowRuns).toHaveLength(0);
    expect(curve.stepLabels).toEqual([
      { name: 'hold', startSec: 0, endSec: 10 },
    ]);
  });

  it("`fast` transition with a previous value inserts the vertical jump", () => {
    const curve = buildProfileCurve([
      {
        name: 'rise',
        pump: 'pressure',
        transition: 'fast',
        seconds: 4,
        pressure: 3,
      },
      {
        name: 'hold',
        pump: 'pressure',
        transition: 'fast',
        seconds: 6,
        pressure: 9,
      },
    ]);
    expect(curve.pressureRuns).toHaveLength(1);
    // First step: (0,3) → (4,3). Second step (fast, runOpen): the run
    // already ends at (4,3); we append (4,9) for the vertical jump and
    // (10,9) for the sustain.
    expect(curve.pressureRuns[0]).toEqual([
      { t: 0, v: 3 },
      { t: 4, v: 3 },
      { t: 4, v: 9 },
      { t: 10, v: 9 },
    ]);
  });

  it("`smooth` transition with a previous value emits a linear ramp", () => {
    const curve = buildProfileCurve([
      {
        name: 'rise',
        pump: 'pressure',
        transition: 'fast',
        seconds: 4,
        pressure: 3,
      },
      {
        name: 'ramp',
        pump: 'pressure',
        transition: 'smooth',
        seconds: 6,
        pressure: 9,
      },
    ]);
    // First step closes at (4,3). Second step is smooth: just append
    // (10, 9) — SVG interpolates linearly between (4,3) and (10,9).
    expect(curve.pressureRuns).toHaveLength(1);
    expect(curve.pressureRuns[0]).toEqual([
      { t: 0, v: 3 },
      { t: 4, v: 3 },
      { t: 10, v: 9 },
    ]);
  });

  it("gaps the series when pump switches from pressure to flow and back", () => {
    // Pattern from a real Decent profile: flow preinfusion → pressure
    // main pour → flow pulse tail. Pressure run and two flow runs.
    const curve = buildProfileCurve([
      {
        name: 'preinfusion',
        pump: 'flow',
        transition: 'fast',
        seconds: 11,
        flow: 8,
      },
      {
        name: 'bloom',
        pump: 'pressure',
        transition: 'fast',
        seconds: 30,
        pressure: 0,
      },
      {
        name: 'pulse',
        pump: 'flow',
        transition: 'fast',
        seconds: 17,
        flow: 8,
      },
    ]);
    expect(curve.durationSec).toBe(58);
    // Pressure has one run during step 2.
    expect(curve.pressureRuns).toHaveLength(1);
    expect(curve.pressureRuns[0]?.[0]).toEqual({ t: 11, v: 0 });
    expect(curve.pressureRuns[0]?.at(-1)).toEqual({ t: 41, v: 0 });
    // Flow has two runs — step 1 and step 3 — gapped during step 2.
    expect(curve.flowRuns).toHaveLength(2);
    expect(curve.flowRuns[0]).toEqual([
      { t: 0, v: 8 },
      { t: 11, v: 8 },
    ]);
    expect(curve.flowRuns[1]?.[0]).toEqual({ t: 41, v: 8 });
    expect(curve.flowRuns[1]?.at(-1)).toEqual({ t: 58, v: 8 });
  });

  it('skips zero / negative-duration steps in the cumulative timeline', () => {
    const curve = buildProfileCurve([
      { name: 'skip', pump: 'pressure', seconds: 0, pressure: 5 },
      { name: 'real', pump: 'pressure', seconds: 5, pressure: 6 },
    ]);
    expect(curve.durationSec).toBe(5);
    expect(curve.pressureRuns).toHaveLength(1);
    expect(curve.pressureRuns[0]?.[0]).toEqual({ t: 0, v: 6 });
  });

  it('ignores steps whose pump is unknown', () => {
    const curve = buildProfileCurve([
      { name: 'mystery', pump: 'gravity', seconds: 5, flow: 4 },
    ]);
    expect(curve.empty).toBe(true);
    // Step labels still record the slot — useful for the step list UI.
    expect(curve.stepLabels).toHaveLength(1);
  });

  it('defaults missing transition to "fast"', () => {
    // No `transition` field in step → treat as fast (the firmware default).
    const curve = buildProfileCurve([
      { name: 'a', pump: 'pressure', seconds: 4, pressure: 3 },
      { name: 'b', pump: 'pressure', seconds: 4, pressure: 9 },
    ]);
    // Vertical jump appears in the run, confirming fast was inferred:
    // last point of step a is (4,3), step b appends (4,9) then (8,9).
    const run = curve.pressureRuns[0]!;
    const jumpAtT4 = run.filter((p) => p.t === 4);
    expect(jumpAtT4.map((p) => p.v).sort()).toEqual([3, 9]);
  });
});

  describe('temperatureRuns', () => {
    it('emits a temperature run from per-step `temperature`', () => {
      const curve = buildProfileCurve([
        {
          name: 'preinfuse',
          pump: 'flow',
          seconds: 4,
          flow: 4,
          temperature: 93,
        },
        {
          name: 'pour',
          pump: 'pressure',
          seconds: 20,
          pressure: 9,
          temperature: 88,
        },
      ]);
      // Both steps contribute to one continuous temperature run since
      // every step declared a temperature.
      expect(curve.temperatureRuns).toHaveLength(1);
      const run = curve.temperatureRuns[0]!;
      expect(run[0]).toEqual({ t: 0, v: 93 });
      expect(run.at(-1)).toEqual({ t: 24, v: 88 });
    });

    it('gaps the temperature run when a step omits `temperature`', () => {
      const curve = buildProfileCurve([
        { name: 'a', pump: 'pressure', seconds: 4, pressure: 6, temperature: 92 },
        { name: 'b', pump: 'pressure', seconds: 4, pressure: 6 },
        { name: 'c', pump: 'pressure', seconds: 4, pressure: 6, temperature: 90 },
      ]);
      expect(curve.temperatureRuns).toHaveLength(2);
    });

    it("contributes to temperature even when pump is 'unknown'", () => {
      // Temperature is independent of the pump mode — a step with an
      // unsupported pump still contributes to the temperature line.
      const curve = buildProfileCurve([
        { name: 'odd', pump: 'gravity', seconds: 5, temperature: 92 },
      ]);
      expect(curve.temperatureRuns).toHaveLength(1);
      expect(curve.temperatureRuns[0]?.[0]).toEqual({ t: 0, v: 92 });
      // Steps with unknown pump don't contribute to pressure/flow.
      expect(curve.pressureRuns).toHaveLength(0);
      expect(curve.flowRuns).toHaveLength(0);
      // Not "empty" — we have a temperature curve to render.
      expect(curve.empty).toBe(false);
    });
  });

describe('maxPressure / maxFlow / maxTemperature', () => {
  it('return 0 for an empty curve', () => {
    const c = buildProfileCurve([]);
    expect(maxPressure(c)).toBe(0);
    expect(maxFlow(c)).toBe(0);
    expect(maxTemperature(c)).toBe(0);
  });

  it('return the highest value seen across all runs', () => {
    const c = buildProfileCurve([
      { name: 'a', pump: 'pressure', seconds: 4, pressure: 6, temperature: 88 },
      { name: 'b', pump: 'flow', seconds: 4, flow: 8, temperature: 92 },
      { name: 'c', pump: 'pressure', seconds: 4, pressure: 11, temperature: 94 },
      { name: 'd', pump: 'flow', seconds: 4, flow: 2, temperature: 90 },
    ]);
    expect(maxPressure(c)).toBe(11);
    expect(maxFlow(c)).toBe(8);
    expect(maxTemperature(c)).toBe(94);
  });
});
