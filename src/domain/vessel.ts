/**
 * A Vessel — the thing you dispense hot water into. A piece of the user's
 * physical kit, like a {@link Pitcher} or a Bean, and named for its *size*
 * ("Small", "Cup", "Mug", "Teapot") rather than for a drink.
 *
 * It carries only what genuinely belongs to a physical object: how much it
 * holds, and how gently you have to pour into it. The pour itself — volume and
 * temperature — lives on the recipe's water step (see `WaterConfig`), so one
 * mug serves a 150 mL americano and a 280 mL tea without inventing two
 * vessels.
 *
 * Unlike `Pitcher.capacityMl` (pure metadata beside a *duration* input),
 * `capacityMl` here is load-bearing: it's the ceiling a step's `volumeMl` is
 * clamped to. Read it as the sensible pour, not the brim.
 */
export interface Vessel {
  id: string;
  /** User-facing label — the size, e.g. "Cup" / "Mug" / "Teapot". */
  name: string;
  /** Nominal capacity in millilitres. Caps any step's requested volume. */
  capacityMl: number;
  /** Hot-water flow (mL/s) — a narrow neck wants a gentler pour. */
  flow: number;
}

/** UX-meaningful bounds on a Vessel's capacity. The DE1 has no say here: the
 *  firmware volume field is unused (we write 0 and own the stop ourselves), so
 *  its single-byte 255 limit does not apply to the target. */
export const VESSEL_CAPACITY_MIN_ML = 10;
export const VESSEL_CAPACITY_MAX_ML = 1000;

/**
 * DE1 hot-water flow bounds. The upper end is 10.0 rather than the 8.0 in
 * `hot_water_form.dart`, because the gateway's own `HotWaterData.defaults()`
 * ships `flow: 10` — clamping to 8 on read would silently slow a machine that
 * had never been touched. Decenza exposes the same 10.0 ceiling.
 */
export const VESSEL_FLOW_MIN = 1.0;
export const VESSEL_FLOW_MAX = 10.0;

/** Build a Vessel with an auto-generated id (override for seed stability). */
export const makeVessel = (
  fields: Omit<Vessel, 'id'> & { id?: string },
): Vessel => ({
  id: fields.id ?? crypto.randomUUID(),
  name: fields.name,
  capacityMl: fields.capacityMl,
  flow: fields.flow,
});
