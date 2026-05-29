/**
 * A milk Pitcher (steaming jug) — a piece of the user's physical kit, like a
 * Bean or Grinder. Each pitcher pairs an identity (name + capacity) with the
 * steam parameters that work well for it: a bigger jug holds more milk and
 * needs longer, and the user may prefer a different flow/target temp per jug.
 *
 * A Recipe references a Pitcher by id (see `Recipe.pitcherId`); at brew time
 * the steam step applies that pitcher's parameters to the machine. Two are
 * seeded by default (Small / Large) so the picker isn't empty.
 */
export interface Pitcher {
  id: string;
  /** User-facing label, e.g. "Small" / "12 oz". */
  name: string;
  /** Nominal capacity in millilitres — identity/metadata, not a steam input. */
  capacityMl: number;
  /** Steam auto-stop duration (s) — the firmware's time-based stop. */
  steamDurationSec: number;
  /** Target steam temperature (°C). */
  steamTempC: number;
  /** Steam flow (mL/s) — lower gives finer milk control. */
  steamFlow: number;
}

/** Build a Pitcher with an auto-generated id (override for seed stability). */
export const makePitcher = (
  fields: Omit<Pitcher, 'id'> & { id?: string },
): Pitcher => ({
  id: fields.id ?? crypto.randomUUID(),
  name: fields.name,
  capacityMl: fields.capacityMl,
  steamDurationSec: fields.steamDurationSec,
  steamTempC: fields.steamTempC,
  steamFlow: fields.steamFlow,
});
