// Water-tank domain helpers — shared by the Home StatusPanel (visual) and the
// RecipePicker (operational blocking). Reaprime reports `currentLevel` in mm.

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

export const isWaterBlocked = (
  mm: number,
  blockMm: number = WATER_BLOCK_MM,
): boolean => mm <= blockMm;

// User-supplied curve fit; matches the machine's tapered tank closely enough for UI.
export const mmToMl = (mm: number): number => mm * 22 + Math.pow(mm, 1.52);

export const waterPct = (mm: number): number =>
  Math.max(0, Math.min(1, mm / WATER_TANK_MAX_MM));
