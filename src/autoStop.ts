/**
 * Auto-stop logic — pure helpers over {@link AutoStopMode}. Kept out of the
 * components so the mode→targets mapping and the scale-applicability rules are
 * unit-testable in isolation. See `prefs.ts` for the mode definitions.
 *
 * Background: the gateway (reaprime `ShotSequencer`) only stops on weight
 * (with a scale) or volume (without one), choosing by scale presence. We can't
 * change that from the skin (see docs/TODO.md for the gateway-side Approach B),
 * so a mode here simply decides which of the two targets OverDose sends.
 */
import type { AutoStopMode } from './prefs';

export type { AutoStopMode };

/** All modes, in display order (selector + tests). */
export const AUTO_STOP_MODES: readonly AutoStopMode[] = [
  'auto',
  'weight',
  'volume',
  'off',
];

/** User-facing label for a mode. */
export const autoStopLabel = (m: AutoStopMode): string => {
  switch (m) {
    case 'weight':
      return 'By weight';
    case 'volume':
      return 'By volume';
    case 'off':
      return 'Manual';
    case 'auto':
    default:
      return 'Automatic';
  }
};

/**
 * Whether a mode can actually trigger a stop given the live scale state.
 * `auto`/`off` always apply; `weight` needs a scale; `volume` needs no scale
 * (the gateway ignores volume while a scale is connected).
 */
export const isStopModeApplicable = (
  m: AutoStopMode,
  scaleConnected: boolean,
): boolean => {
  switch (m) {
    case 'weight':
      return scaleConnected;
    case 'volume':
      return !scaleConnected;
    case 'auto':
    case 'off':
    default:
      return true;
  }
};

/**
 * Short reason a mode is unavailable in the current scale state — for the
 * disabled chip in the prep selector. Null when the mode is applicable.
 */
export const autoStopUnavailableReason = (
  m: AutoStopMode,
  scaleConnected: boolean,
): string | null => {
  if (isStopModeApplicable(m, scaleConnected)) return null;
  return m === 'weight' ? 'needs a scale' : 'needs no scale';
};

export interface StopTargets {
  /** `workflow.context.targetYield` — null clears it (no weight stop). */
  targetYield: number | null;
  /** `profile.target_volume` — always set explicitly (0 = no volume stop). */
  targetVolume: number;
}

/**
 * Resolve the stop targets to push for a mode, given the draft's per-shot
 * yield/volume and the profile's own built-in volume. The volume value falls
 * back draft → profile → 0. `weight`/`off` force volume to 0 (suppressing the
 * profile's built-in); `volume`/`off` clear the yield.
 */
export const computeStopTargets = (
  mode: AutoStopMode,
  opts: {
    draftYieldG?: number;
    draftVolumeMl?: number;
    profileVolumeMl?: number;
  },
): StopTargets => {
  const yieldG = opts.draftYieldG ?? null;
  const vol = opts.draftVolumeMl ?? opts.profileVolumeMl ?? 0;
  switch (mode) {
    case 'weight':
      return { targetYield: yieldG, targetVolume: 0 };
    case 'volume':
      return { targetYield: null, targetVolume: vol };
    case 'off':
      return { targetYield: null, targetVolume: 0 };
    case 'auto':
    default:
      return { targetYield: yieldG, targetVolume: vol };
  }
};
