// Water-tank domain helpers — shared by the Home StatusPanel (visual) and the
// RecipePicker (operational blocking). Reaprime reports `currentLevel` in mm.

import { createMemo, type Accessor } from 'solid-js';
import type { WaterLevelsSnapshot } from './snapshot';
import type { WaterUnit } from './prefs';

// DE1 tank: full at ~65mm.
export const WATER_TANK_MAX_MM = 65;

// TEMPORARY (2026-07 debug): DE1 intake-tube offset, gated by the
// `waterIntakeOffset` pref (default on — see DEFAULT_WATER_INTAKE_OFFSET).
//
// The DE1 reports water height from the intake tube, which sits ~5mm above the
// true tank bottom. DE1App adds this back before its tank-volume math; reaprime
// forwards the raw value ("what the machine sees"). Our mL curve (mmToMl) and
// full-tank height (WATER_TANK_MAX_MM) inherit DE1App's tank-bottom frame, so
// without the offset the readout under-reports by ~5mm of water.
//
// Applied to the *displayed* level only (mm / mL / fill bar). Severity + alert
// thresholds stay in the raw machine frame: adding a constant to both sides of
// the `currentLevel <= refillLevel` compare is a no-op, so critical alerts
// remain aligned with the machine. Intent is to settle on fixed behaviour and
// drop the toggle once it's been felt out on real hardware.
export const WATER_INTAKE_OFFSET_MM = 5;

/** Level (mm) to show/convert, with the intake-tube offset optionally applied. */
export const effectiveLevelMm = (rawMm: number, applyOffset: boolean): number =>
  applyOffset ? rawMm + WATER_INTAKE_OFFSET_MM : rawMm;

// Water-alert thresholds (mm), compared as `currentLevel <= threshold`.
// `warn` is the skin-only visual nudge — a UserPrefs setting seeded from
// WATER_WARN_MM. `block`/critical is NOT a skin value: it comes from the
// machine's reported `refillLevel` (see WaterLevelsSnapshot), so the skin's
// critical alert always matches when the DE1 itself decides it needs water.
// WATER_BLOCK_MM is only a fallback default for the helpers below when no
// machine refill level is available (e.g. tests).
export const WATER_WARN_MM = 5;
export const WATER_BLOCK_MM = 3;

export type WaterSeverity = 'normal' | 'warn' | 'critical';

export const waterSeverity = (
  mm: number,
  warnMm: number = WATER_WARN_MM,
  blockMm: number = WATER_BLOCK_MM,
): WaterSeverity =>
  mm <= blockMm ? 'critical' : mm <= warnMm ? 'warn' : 'normal';

// Hysteresis margin (mm) for the *committed* severity. The DE1 water sensor
// jitters by a fraction of a mm, so a raw threshold compare flip-flops when the
// true level sits near a boundary — re-firing the alert. We absorb that with
// asymmetric hysteresis: severity escalates instantly (alerts never fire late),
// but only de-escalates once the level clears the relevant threshold by this
// margin, so jitter can't toggle the alert off and back on.
export const WATER_HYSTERESIS_MM = 2;

const severityRank = (s: WaterSeverity): number =>
  s === 'critical' ? 2 : s === 'warn' ? 1 : 0;

/**
 * Stateful, hysteretic severity derived from the live water-levels stream.
 * Create ONCE (at the streams owner) and share the returned accessor across
 * every consumer — header pill, status banner, audio cue, and the operational
 * block gate — so they always agree on a single committed state.
 *
 * `critical` tracks the machine's own `refillLevel` (per frame); `warn` is the
 * skin pref `warnMm`. Only the categorical severity is smoothed — raw
 * `currentLevel` is still the source for numeric/bar displays.
 */
export const createWaterSeverity = (
  levels: Accessor<WaterLevelsSnapshot | null>,
  warnMm: Accessor<number>,
  marginMm: number = WATER_HYSTERESIS_MM,
): Accessor<WaterSeverity> => {
  let committed: WaterSeverity = 'normal';
  return createMemo<WaterSeverity>(() => {
    const w = levels();
    if (!w) return committed; // no frame yet → hold (starts 'normal')
    const blockMm = w.refillLevel ?? 0;
    const mm = w.currentLevel;
    const raw = waterSeverity(mm, warnMm(), blockMm);

    // Escalating (or unchanged): commit immediately — never delay an alert.
    if (severityRank(raw) >= severityRank(committed)) {
      committed = raw;
      return committed;
    }

    // De-escalating: only step down once the level clears each exit threshold
    // by the margin. Cascades critical→warn→normal in one pass when the tank
    // is refilled well past warn (warnMm > blockMm ⇒ thresholds stay ordered).
    let next = committed;
    if (next === 'critical' && mm > blockMm + marginMm) next = 'warn';
    if (next === 'warn' && mm > warnMm() + marginMm) next = 'normal';
    committed = next;
    return committed;
  });
};

export const isWaterBlocked = (
  mm: number,
  blockMm: number = WATER_BLOCK_MM,
): boolean => mm <= blockMm;

// User-supplied curve fit; matches the machine's tapered tank closely enough for UI.
export const mmToMl = (mm: number): number => mm * 22 + Math.pow(mm, 1.52);

export const waterPct = (mm: number): number =>
  Math.max(0, Math.min(1, mm / WATER_TANK_MAX_MM));

// Fill fraction (0–1) for the tank bar, matched to the *displayed* unit so the
// bar and the number always tell the same story:
//   'mm' / 'both' → % of tank height (linear; mm is the source of truth)
//   'mL'          → % of tank volume (uses mmToMl so the taper is reflected —
//                   a half-height reading fills to ~46%, not 50%).
export const waterFillPct = (mm: number, unit: WaterUnit): number =>
  unit === 'mL'
    ? Math.max(0, Math.min(1, mmToMl(mm) / mmToMl(WATER_TANK_MAX_MM)))
    : waterPct(mm);
