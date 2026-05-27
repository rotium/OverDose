import type { Routine } from '../domain';

/**
 * Repository for Routines — the "how I brew this drink" templates that
 * Recipes reference. Same Promise-returning interface as the other
 * repositories so a gateway-backed swap-in stays call-site-compatible
 * (see [[starter-skin-storage]]).
 *
 * `listVisible()` filters out hidden routines (private clones created by
 * detaching a Recipe). The Routine Library should only show visible ones;
 * the runtime + Recipe resolution use `get()` regardless of visibility.
 */
export interface RoutineRepository {
  list(): Promise<Routine[]>;
  listVisible(): Promise<Routine[]>;
  get(id: string): Promise<Routine | null>;
  create(routine: Routine): Promise<Routine>;
  update(routine: Routine): Promise<Routine>;
  delete(id: string): Promise<void>;
}
