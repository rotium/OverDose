import type { GatewayShotRecord, GatewayShotSummary } from './api';
import type { FrozenLiveShot } from './liveShot';

/**
 * Window for the optimistic→gateway hand-off.
 *
 * The optimistic record's `timestamp` is the first captured frame's machine
 * timestamp; the gateway records the *same* shot starting a touch earlier (it
 * captures from the true shot start), so its timestamp is ≤ ours. A strict
 * "gateway ≥ optimistic" therefore never flips on real hardware, stranding the
 * UI on the optimistic record forever (so post-brew edits never get a real
 * shot id to save against).
 *
 * Both timestamps are in the same machine clock, and the *previous* shot is far
 * older (a whole shot cycle + review), so we instead treat the gateway's latest
 * as "the shot we just brewed" once it's within this window of our start. Two
 * espresso shots can't start within ~10 s of each other, so this can't latch
 * onto the previous shot.
 */
export const HANDOFF_WINDOW_MS = 10_000;

/**
 * Has the gateway caught up to the shot the optimistic record stands in for?
 * True once the gateway's latest shot timestamp is within {@link
 * HANDOFF_WINDOW_MS} of the optimistic start (in either direction).
 */
export const gatewayCaughtUp = (
  gatewaySummary: GatewayShotSummary | null | undefined,
  optimisticTimestamp: string,
): boolean => {
  if (!gatewaySummary) return false;
  const gap = Date.parse(optimisticTimestamp) - Date.parse(gatewaySummary.timestamp);
  return gap <= HANDOFF_WINDOW_MS;
};

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
