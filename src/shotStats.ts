import type { GatewayShotRecord, GatewayShotSummary } from './api';

/**
 * Pure derivations over a completed shot — shared by LastShotCard (compact)
 * and the RecipeBrewScreen post-brew summary (full). Keeping these in one
 * place means the two surfaces never drift on, e.g., the yield fallback
 * chain or how peak pressure is computed.
 *
 * Split into summary-derived (headline, targets, dose) and measurement-
 * derived (yield, duration, peaks, volume) because the two arrive on
 * different fetches and at different times — the caller passes whichever
 * it has.
 *
 * **Actual vs target are kept distinct** (e.g. `yieldG` is the measured
 * value, `targetYieldG` the configured one) so a consumer can show both
 * without conflating them. LastShotCard collapses them (`yieldG ?? targetYieldG`)
 * for its single-line display; the post-brew screen shows them separately.
 */

const num = (v: unknown): number | null =>
  typeof v === 'number' && !Number.isNaN(v) ? v : null;

/** Profile title → workflow name → coffee name → "Shot". */
export const shotHeadline = (summary: GatewayShotSummary | null): string =>
  summary?.workflow?.profile?.title ??
  summary?.workflow?.name ??
  summary?.workflow?.context?.coffeeName ??
  'Shot';

/**
 * Muted second line: recipe slot + bean, when the headline is the profile.
 * Empty when there's nothing distinct to add (headline already the recipe
 * name, or no recipe/bean set).
 */
export const shotSubtitle = (summary: GatewayShotSummary | null): string => {
  const wf = summary?.workflow;
  if (!wf) return '';
  const profileTitle = wf.profile?.title ?? '';
  const recipeName = wf.name ?? '';
  const coffeeName = wf.context?.coffeeName ?? '';
  if (!profileTitle) {
    return recipeName && coffeeName && coffeeName !== recipeName
      ? coffeeName
      : '';
  }
  const parts: string[] = [];
  if (recipeName) parts.push(recipeName);
  if (coffeeName && coffeeName !== recipeName) parts.push(coffeeName);
  return parts.join(' · ');
};

/** Dose (g): measured actual if present, else the configured target. */
export const shotDoseG = (summary: GatewayShotSummary | null): number | null =>
  num(summary?.annotations?.actualDoseWeight) ??
  num(summary?.workflow?.context?.targetDoseWeight);

/** Last non-NaN scale weight in the record — the measured final yield. */
export const shotLastScaleWeight = (
  full: GatewayShotRecord | null,
): number | null => {
  const ms = full?.measurements;
  if (!ms?.length) return null;
  for (let i = ms.length - 1; i >= 0; i--) {
    const w = ms[i]?.scale?.weight;
    if (typeof w === 'number' && !Number.isNaN(w)) return w;
  }
  return null;
};

/** Measured yield (g): user-entered actual, else last scale weight. Does
 *  NOT fall back to the target — that's `shotTargetYieldG`. */
export const shotYieldG = (
  summary: GatewayShotSummary | null,
  full: GatewayShotRecord | null,
): number | null =>
  num(summary?.annotations?.actualYield) ?? shotLastScaleWeight(full);

/** Configured stop-at-weight target (g). */
export const shotTargetYieldG = (
  summary: GatewayShotSummary | null,
): number | null => num(summary?.workflow?.context?.targetYield);

/** Shot duration (s) from first→last measurement. */
export const shotDurationSec = (
  full: GatewayShotRecord | null,
): number | null => {
  const ms = full?.measurements;
  if (!ms || ms.length < 2) return null;
  const first = ms[0]!.machine.timestamp;
  const last = ms[ms.length - 1]!.machine.timestamp;
  return Math.round((Date.parse(last) - Date.parse(first)) / 1000);
};

/** Peak group pressure (bar) across the shot. */
export const shotPeakPressureBar = (
  full: GatewayShotRecord | null,
): number | null => {
  const ms = full?.measurements;
  if (!ms?.length) return null;
  let max = -Infinity;
  for (const m of ms) if (m.machine.pressure > max) max = m.machine.pressure;
  return max === -Infinity ? null : max;
};

/** Peak group flow (mL/s) across the shot. */
export const shotPeakFlowMlS = (
  full: GatewayShotRecord | null,
): number | null => {
  const ms = full?.measurements;
  if (!ms?.length) return null;
  let max = -Infinity;
  for (const m of ms) if (m.machine.flow > max) max = m.machine.flow;
  return max === -Infinity ? null : max;
};

/**
 * Dispensed volume (mL): flow integrated over the measurements
 * (left-Riemann, matching the gateway + the live accumulator). The
 * persisted measurements may carry a `volume` field, but integrating from
 * flow works for both gateway records and the in-memory optimistic record
 * (which has no volume field).
 */
export const shotVolumeMl = (
  full: GatewayShotRecord | null,
): number | null => {
  const ms = full?.measurements;
  if (!ms || ms.length < 2) return null;
  let vol = 0;
  for (let i = 1; i < ms.length; i++) {
    const dtSec =
      (Date.parse(ms[i]!.machine.timestamp) -
        Date.parse(ms[i - 1]!.machine.timestamp)) /
      1000;
    if (dtSec > 0) vol += ms[i]!.machine.flow * dtSec;
  }
  return vol;
};

/** Configured volume target (mL) from the profile. */
export const shotTargetVolumeMl = (
  summary: GatewayShotSummary | null,
): number | null => num(summary?.workflow?.profile?.target_volume);

/**
 * Counted volume (mL): like {@link shotVolumeMl}, but only integrates samples
 * at or past `countStart` — the profile's `target_volume_count_start`. This
 * mirrors the window the gateway's volume-stop actually measures (pre-infusion
 * excluded), so it can be compared against the full dispensed volume.
 *
 * Returns null when samples lack the per-frame index (older / optimistic
 * records can't be windowed) so the caller can hide the figure rather than
 * show a misleadingly-low number.
 */
export const shotCountedVolumeMl = (
  full: GatewayShotRecord | null,
  countStart: number,
): number | null => {
  const ms = full?.measurements;
  if (!ms || ms.length < 2) return null;
  let vol = 0;
  let sawFrame = false;
  for (let i = 1; i < ms.length; i++) {
    const m = ms[i]!.machine;
    const frame = m.profileFrame;
    if (frame === undefined) continue;
    sawFrame = true;
    if (frame < countStart) continue;
    // Exclude the post-stop pump ramp-down (mirrors the gateway + the live
    // accumulator): only count while actively pouring. Records without a
    // per-sample substate fall back to counting (undefined treated as active).
    const sub = m.state?.substate;
    if (sub !== undefined && sub !== 'pouring' && sub !== 'preinfusion') {
      continue;
    }
    const dtSec =
      (Date.parse(m.timestamp) - Date.parse(ms[i - 1]!.machine.timestamp)) /
      1000;
    if (dtSec > 0) vol += m.flow * dtSec;
  }
  return sawFrame ? vol : null;
};

export interface ShotStats {
  headline: string;
  subtitle: string;
  doseG: number | null;
  yieldG: number | null;
  targetYieldG: number | null;
  durationSec: number | null;
  peakPressureBar: number | null;
  peakFlowMlS: number | null;
  volumeMl: number | null;
  targetVolumeMl: number | null;
  /** Volume counted from `volumeCountStart` onward, or null when the profile
   *  counts from the start (count-start 0) or the record can't be windowed. */
  countedVolumeMl: number | null;
  /** The profile's volume count-start step, when > 0 (else null). Presence
   *  gates the counted-volume display. */
  volumeCountStart: number | null;
}

/** Real-unit values at a sample index — drives the full-mode chart's readout
 *  strip as the crosshair scrubs. Returns null for an out-of-range index. */
export interface ShotReadout {
  timeSec: number;
  pressure: number | null;
  flow: number | null;
  mixTemp: number | null;
  weight: number | null;
  stepName: string | null;
}

export const shotReadoutAt = (
  rec: GatewayShotRecord,
  idx: number | null,
): ShotReadout | null => {
  const ms = rec.measurements;
  if (idx == null || !ms || idx < 0 || idx >= ms.length) return null;
  const m = ms[idx]!;
  const t0 = Date.parse(ms[0]!.machine.timestamp) / 1000;
  const frame = m.machine.profileFrame;
  return {
    timeSec: Date.parse(m.machine.timestamp) / 1000 - t0,
    pressure: num(m.machine.pressure),
    flow: num(m.machine.flow),
    mixTemp: num(m.machine.mixTemperature),
    weight: num(m.scale?.weight),
    stepName:
      frame != null ? (rec.workflow?.profile?.steps?.[frame]?.name ?? null) : null,
  };
};

export const deriveShotStats = (
  summary: GatewayShotSummary | null,
  full: GatewayShotRecord | null,
): ShotStats => {
  // Count-start only matters when > 0 — at 0 the counted volume equals the
  // total, so we leave both stat fields null and show just the one figure.
  const countStart = num(summary?.workflow?.profile?.target_volume_count_start);
  const hasCountStart = countStart != null && countStart > 0;
  return {
    headline: shotHeadline(summary),
    subtitle: shotSubtitle(summary),
    doseG: shotDoseG(summary),
    yieldG: shotYieldG(summary, full),
    targetYieldG: shotTargetYieldG(summary),
    durationSec: shotDurationSec(full),
    peakPressureBar: shotPeakPressureBar(full),
    peakFlowMlS: shotPeakFlowMlS(full),
    volumeMl: shotVolumeMl(full),
    targetVolumeMl: shotTargetVolumeMl(summary),
    countedVolumeMl: hasCountStart ? shotCountedVolumeMl(full, countStart) : null,
    volumeCountStart: hasCountStart ? countStart : null,
  };
};
