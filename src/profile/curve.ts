/**
 * Profile-curve parser for the espresso-profile preview pane.
 *
 * Takes the gateway's opaque `Profile.steps` array (Jeff Kletsky v2 JSON
 * shape — see reaprime/doc/Profiles.md) and produces pressure / flow
 * series ready for SVG rendering. Pure functions, no DOM, no Solid —
 * unit-tested independently of the picker UI.
 *
 * v1 simplifications:
 *  - The curve shows the *target* shape, not what the puck actually does.
 *    Pressure-controlled steps contribute to the pressure series; flow-
 *    controlled steps contribute to the flow series; the other line is
 *    gapped (rendered as separate polylines, not one continuous line).
 *  - 'fast' transition → vertical jump at the step boundary, then flat.
 *  - 'smooth' transition → linear ramp from the previous value to the
 *    target over the step's full duration.
 *  - Exit conditions (`exit`, `weight`, `volume` early-stop triggers) are
 *    ignored. We render the full `seconds` as if no exit fires.
 *  - Temperature variation per step is not plotted — `tank_temperature`
 *    surfaces as a single chip in the metadata instead.
 */

export interface SeriesPoint {
  /** Seconds since profile start. */
  t: number;
  /** Value — bar for pressure, mL/s for flow. */
  v: number;
}

export interface StepLabel {
  name: string;
  startSec: number;
  endSec: number;
}

export interface ProfileCurve {
  /** Each inner array is one contiguous run of points; render as its own
   *  polyline so gaps between pressure / flow control regions don't draw
   *  misleading connecting lines. */
  pressureRuns: SeriesPoint[][];
  flowRuns: SeriesPoint[][];
  /** Target water temperature (°C) per step. Usually one continuous run
   *  since every step typically declares a temperature, but split into
   *  runs the same way pressure/flow do — to gap cleanly if a step omits
   *  the field. */
  temperatureRuns: SeriesPoint[][];
  durationSec: number;
  stepLabels: StepLabel[];
  /** True when nothing parseable was found — the preview shows a
   *  "no step data" fallback. */
  empty: boolean;
}

interface ParsedStep {
  name: string;
  pump: 'pressure' | 'flow' | 'unknown';
  transition: 'fast' | 'smooth';
  seconds: number;
  pressure?: number;
  flow?: number;
  temperature?: number;
}

const parseStep = (s: unknown): ParsedStep | null => {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const seconds = typeof o.seconds === 'number' && o.seconds > 0 ? o.seconds : 0;
  if (seconds === 0) return null; // skip zero-duration entries
  const pump: ParsedStep['pump'] =
    o.pump === 'pressure' ? 'pressure' : o.pump === 'flow' ? 'flow' : 'unknown';
  const transition: ParsedStep['transition'] =
    o.transition === 'smooth' ? 'smooth' : 'fast';
  const name = typeof o.name === 'string' ? o.name : '';
  return {
    name,
    pump,
    transition,
    seconds,
    pressure: typeof o.pressure === 'number' ? o.pressure : undefined,
    flow: typeof o.flow === 'number' ? o.flow : undefined,
    temperature: typeof o.temperature === 'number' ? o.temperature : undefined,
  };
};

/** Append a step's contribution to a series. Mutates `runs`. */
const appendStep = (
  runs: SeriesPoint[][],
  runOpen: boolean,
  prev: number | undefined,
  target: number,
  t0: number,
  t1: number,
  transition: 'fast' | 'smooth',
): void => {
  let run: SeriesPoint[];
  if (runOpen) {
    run = runs[runs.length - 1]!;
  } else {
    run = [];
    runs.push(run);
  }

  if (runOpen && prev !== undefined) {
    if (transition === 'fast') {
      // The run already ends at (t0, prev) — the previous step's
      // sustain landed there. Append (t0, target) for the vertical jump,
      // then (t1, target) for the sustain.
      run.push({ t: t0, v: target });
      run.push({ t: t1, v: target });
    } else {
      // Smooth: the run already ends at (t0, prev). Linear ramp to
      // (t1, target) — SVG polyline interpolates between adjacent points.
      run.push({ t: t1, v: target });
    }
  } else {
    // New run (gap before this, or first ever contribution): start flat
    // at target. We don't have a meaningful previous value to ramp from.
    run.push({ t: t0, v: target });
    run.push({ t: t1, v: target });
  }
};

export const buildProfileCurve = (steps: unknown): ProfileCurve => {
  const empty: ProfileCurve = {
    pressureRuns: [],
    flowRuns: [],
    temperatureRuns: [],
    durationSec: 0,
    stepLabels: [],
    empty: true,
  };
  if (!Array.isArray(steps) || steps.length === 0) return empty;

  const parsed = steps
    .map(parseStep)
    .filter((s): s is ParsedStep => s !== null);
  if (parsed.length === 0) return empty;

  const pressureRuns: SeriesPoint[][] = [];
  const flowRuns: SeriesPoint[][] = [];
  const temperatureRuns: SeriesPoint[][] = [];
  const stepLabels: StepLabel[] = [];
  let cumulativeT = 0;
  let prevPressure: number | undefined;
  let prevFlow: number | undefined;
  let prevTemperature: number | undefined;
  let pressureRunOpen = false;
  let flowRunOpen = false;
  let temperatureRunOpen = false;

  for (const step of parsed) {
    const t0 = cumulativeT;
    const t1 = cumulativeT + step.seconds;
    stepLabels.push({ name: step.name, startSec: t0, endSec: t1 });

    const contributesPressure =
      step.pump === 'pressure' && step.pressure !== undefined;
    const contributesFlow = step.pump === 'flow' && step.flow !== undefined;
    // Temperature is independent of pump — a step's `temperature` field is
    // the target group-head water temp for that step regardless of whether
    // pressure or flow is being controlled.
    const contributesTemperature = step.temperature !== undefined;

    if (contributesPressure) {
      appendStep(
        pressureRuns,
        pressureRunOpen,
        prevPressure,
        step.pressure!,
        t0,
        t1,
        step.transition,
      );
      prevPressure = step.pressure!;
      pressureRunOpen = true;
    } else {
      pressureRunOpen = false;
    }

    if (contributesFlow) {
      appendStep(
        flowRuns,
        flowRunOpen,
        prevFlow,
        step.flow!,
        t0,
        t1,
        step.transition,
      );
      prevFlow = step.flow!;
      flowRunOpen = true;
    } else {
      flowRunOpen = false;
    }

    if (contributesTemperature) {
      appendStep(
        temperatureRuns,
        temperatureRunOpen,
        prevTemperature,
        step.temperature!,
        t0,
        t1,
        step.transition,
      );
      prevTemperature = step.temperature!;
      temperatureRunOpen = true;
    } else {
      temperatureRunOpen = false;
    }

    cumulativeT = t1;
  }

  return {
    pressureRuns,
    flowRuns,
    temperatureRuns,
    durationSec: cumulativeT,
    stepLabels,
    empty:
      pressureRuns.length === 0 &&
      flowRuns.length === 0 &&
      temperatureRuns.length === 0,
  };
};

/** Largest value across all pressure runs (for axis scaling). 0 when empty. */
export const maxPressure = (curve: ProfileCurve): number => {
  let max = 0;
  for (const run of curve.pressureRuns) {
    for (const p of run) if (p.v > max) max = p.v;
  }
  return max;
};

/** Largest value across all flow runs. 0 when empty. */
export const maxFlow = (curve: ProfileCurve): number => {
  let max = 0;
  for (const run of curve.flowRuns) {
    for (const p of run) if (p.v > max) max = p.v;
  }
  return max;
};

/** Largest value across all temperature runs (°C). 0 when empty. */
export const maxTemperature = (curve: ProfileCurve): number => {
  let max = 0;
  for (const run of curve.temperatureRuns) {
    for (const p of run) if (p.v > max) max = p.v;
  }
  return max;
};
