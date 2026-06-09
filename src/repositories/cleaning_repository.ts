import type { Cleaning } from '../domain';

/**
 * Repository for Cleanings — machine-maintenance routines configured like
 * Recipes. Local-first behind a Promise API so a gateway-backed swap-in later
 * doesn't change call sites (see [[starter-skin-storage]]).
 */
export interface CleaningRepository {
  list(): Promise<Cleaning[]>;
  get(id: string): Promise<Cleaning | null>;
  create(cleaning: Cleaning): Promise<Cleaning>;
  update(cleaning: Cleaning): Promise<Cleaning>;
  delete(id: string): Promise<void>;
  /** Replace the whole collection — used by the library sync on pull. */
  replaceAll(cleanings: Cleaning[]): Promise<void>;
}
