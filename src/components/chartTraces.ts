/**
 * Single source of truth for the five solid traces' colours and the
 * per-trace transforms used to land them on the chart's unitless 0–12
 * Y axis. Consumed by both `LiveShotChart` (during a brew) and
 * `ShotMiniChart` (frozen-shot review), so any palette tweak lands in
 * one place and never drifts between the two views.
 *
 * Transforms match the DE1 convention of "compressed Y axis": pressure
 * and flow render at their raw numeric values (≈ 0–10), while weight and
 * mix temp are divided by 10 so 36 g shows as 3.6 and 92 °C shows as 9.2.
 * Real units live in the readouts/legend, not on the axis.
 */

export const TRACE_COLOR = {
  pressure: '#3b82f6', // blue
  flow: '#f59e0b', // amber
  weightFlow: '#a855f7', // purple
  weight: '#22c55e', // green
  mixTemperature: '#ef4444', // red
} as const;

export type TraceColorKey = keyof typeof TRACE_COLOR;

export const TRACE_TRANSFORM = {
  pressure: (n: number) => n,
  flow: (n: number) => n,
  weightFlow: (n: number) => n,
  weight: (n: number) => n / 10,
  mixTemperature: (n: number) => n / 10,
} as const;
