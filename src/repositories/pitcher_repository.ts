import type { Pitcher } from '../domain';

/**
 * Repository for Pitchers (steaming jugs) — a library entity like Recipes
 * and Routines. Recipes reference a Pitcher by id; the brew runtime reads it
 * to apply the steam parameters.
 *
 * Promise-returning so a gateway-backed swap-in later doesn't require
 * call-site changes (see [[starter-skin-storage]]).
 */
export interface PitcherRepository {
  list(): Promise<Pitcher[]>;
  get(id: string): Promise<Pitcher | null>;
  create(pitcher: Pitcher): Promise<Pitcher>;
  update(pitcher: Pitcher): Promise<Pitcher>;
  delete(id: string): Promise<void>;
  /** Replace the whole collection — library sync pull. See docs/storage-sync.md. */
  replaceAll(pitchers: Pitcher[]): Promise<void>;
}
