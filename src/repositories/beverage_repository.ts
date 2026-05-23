import type { Beverage } from '../domain';

/**
 * Repository for Beverages — the "how I brew this drink" templates that
 * Recipes reference. Same Promise-returning interface as the other
 * repositories so a gateway-backed swap-in stays call-site-compatible
 * (see [[starter-skin-storage]]).
 *
 * `listVisible()` filters out hidden beverages (private clones created by
 * detaching a Recipe). The Beverage Library should only show visible ones;
 * the runtime + Recipe resolution use `get()` regardless of visibility.
 */
export interface BeverageRepository {
  list(): Promise<Beverage[]>;
  listVisible(): Promise<Beverage[]>;
  get(id: string): Promise<Beverage | null>;
  create(beverage: Beverage): Promise<Beverage>;
  update(beverage: Beverage): Promise<Beverage>;
  delete(id: string): Promise<void>;
}
