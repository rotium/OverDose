// Water-tank domain helpers — shared by the Home StatusPanel (visual) and the
// RecipePicker (operational blocking). Reaprime reports `currentLevel` in mm.

import { createMemo, type Accessor } from 'solid-js';
import type { WaterLevelsSnapshot } from './snapshot';

// DE1 tank: full at ~65mm.
export const WATER_TANK_MAX_MM = 65;

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

// ── Intake-tube dead zone / reserve ──────────────────────────────────────────
// The DE1 sensor measures height up the intake tube, which sits ~8mm above the
// true tank bottom, so it reports 0 until the tank holds the reserve below the
// tube (≈ mmToMl(8) ≈ 200mL — the level the user sees start moving on real
// hardware). The reservoir is *visible*, so we don't hide that water like a
// battery buffer: we shift the whole display up by this offset and draw the
// reserve as its own zone in the bar. TUNABLE — eyeball estimate, validate on
// hardware. Severity/alerts stay in the raw sensor frame (see waterSeverity):
// a uniform offset on both sides of the refill compare is a no-op there.
export const WATER_DEAD_ZONE_MM = 8;

// Displayed full height = raw full (WATER_TANK_MAX_MM) + the reserve offset.
export const WATER_DISPLAY_MAX_MM = WATER_TANK_MAX_MM + WATER_DEAD_ZONE_MM;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** True water height (mm from the tank bottom) for a raw sensor reading. */
export const toDisplayMm = (rawMm: number): number => rawMm + WATER_DEAD_ZONE_MM;

/** Displayed volume (mL) incl. the below-tube reserve. */
export const displayMl = (rawMm: number): number => mmToMl(toDisplayMm(rawMm));

/** The sensor can't measure below the tube — raw pins at 0 through the reserve. */
export const isBelowSensor = (rawMm: number): boolean => rawMm <= 0;

/** Bar fill (0–1) by volume incl. reserve — one physical bar for every unit. */
export const waterFillPct = (rawMm: number): number =>
  clamp01(displayMl(rawMm) / mmToMl(WATER_DISPLAY_MAX_MM));

/** Constant width (0–1) of the always-present reserve zone at the base of the bar. */
export const WATER_RESERVE_FRAC =
  mmToMl(WATER_DEAD_ZONE_MM) / mmToMl(WATER_DISPLAY_MAX_MM);
