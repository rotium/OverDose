// Water-tank domain helpers — shared by the Home StatusPanel (visual) and the
// WorkflowPicker (operational blocking). Reaprime reports `currentLevel` in mm.

// DE1 tank: full at ~65mm.
export const WATER_TANK_MAX_MM = 65;

// Default low-water alert thresholds (mm). Seeded into UserPrefsContext on
// first run; runtime values come from the prefs context so the Settings
// screen can tune them. `warn` is visual only; `block` gates workflow
// continuation. Compared as `currentLevel <= threshold`.
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
