import type { GatewayShotRecord } from './api';
import type { FrozenLiveShot } from './liveShot';

/**
 * Convert an in-memory frozen live shot into the GatewayShotRecord shape so
 * LastShotCard can render it identically to a gateway-persisted record.
 *
 * The workflow envelope (name + context + profile) is passed through as-is.
 * That keeps the optimistic shot's *headline resolution* identical to the
 * gateway path: profile.title → workflow.name → coffeeName → "Shot".
 *
 * Annotations are intentionally NOT pre-filled with dose/yield. In reaprime,
 * `annotations.actualDoseWeight/actualYield` are only set by user edits or
 * import parsers; the gateway never fills them for freshly-recorded shots.
 * LastShotCard reads dose/yield from `workflow.context.target*` with a
 * fallback chain, so leaving annotations empty here keeps the optimistic
 * and gateway paths displaying the same numbers.
 *
 * The synthetic `id` (prefixed `optimistic-`) is unmistakable in dev tools
 * but the card never displays it.
 */
export const frozenToGatewayShotRecord = (
  frozen: FrozenLiveShot,
): GatewayShotRecord => {
  return {
    id: `optimistic-${frozen.startedAt}`,
    timestamp: frozen.startedAt,
    workflow: frozen.workflow
      ? {
          name: frozen.workflow.name,
          description: frozen.workflow.description,
          context: frozen.workflow.context,
          profile: frozen.workflow.profile,
        }
      : undefined,
    measurements: frozen.measurements,
  };
};
