import type { Vessel } from '../domain';

/**
 * Repository for Vessels (hot-water cups/mugs/teapots) — a library entity like
 * Pitchers and Recipes. A recipe's water step references a Vessel by id; the
 * brew runtime reads it for the flow and the volume ceiling.
 *
 * Promise-returning so a gateway-backed swap-in later doesn't require
 * call-site changes (see [[starter-skin-storage]]).
 */
export interface VesselRepository {
  list(): Promise<Vessel[]>;
  get(id: string): Promise<Vessel | null>;
  create(vessel: Vessel): Promise<Vessel>;
  update(vessel: Vessel): Promise<Vessel>;
  delete(id: string): Promise<void>;
  /** Replace the whole collection — library sync pull. See docs/storage-sync.md. */
  replaceAll(vessels: Vessel[]): Promise<void>;
}
