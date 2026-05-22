// Water-tank domain helpers — shared by the Home StatusPanel (visual) and the
// WorkflowPicker (operational blocking). Reaprime reports `currentLevel` in mm;
// these constants live here so a future Settings screen can drive them.

// DE1 tank: full at ~65mm.
export const WATER_TANK_MAX_MM = 65;

// Low-water alert thresholds (mm). `warn` is visual only; `block` gates workflow
// continuation. Compared as `currentLevel <= threshold`.
export const WATER_WARN_MM = 5;
export const WATER_BLOCK_MM = 3;

export type WaterSeverity = 'normal' | 'warn' | 'critical';

export const waterSeverity = (mm: number): WaterSeverity =>
  mm <= WATER_BLOCK_MM ? 'critical' : mm <= WATER_WARN_MM ? 'warn' : 'normal';

export const isWaterBlocked = (mm: number): boolean => mm <= WATER_BLOCK_MM;

// User-supplied curve fit; matches the machine's tapered tank closely enough for UI.
export const mmToMl = (mm: number): number => mm * 22 + Math.pow(mm, 1.52);

export const waterPct = (mm: number): number =>
  Math.max(0, Math.min(1, mm / WATER_TANK_MAX_MM));
