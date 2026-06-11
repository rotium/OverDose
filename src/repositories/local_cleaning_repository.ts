import type { Cleaning } from '../domain';
import type { CleaningRepository } from './cleaning_repository';
import { SEED_CLEANINGS } from './seed_cleanings';

// v3: the reminder model changed incompatibly (relative `cadence.byDays` →
// `reminder` calendar grid). Bumping the key drops the old data and re-seeds
// with model-B reminders. (v2 was the flat-kind → Clean-steps redesign.)
const STORAGE_KEY = 'starter-skin.cleanings.v3';
const SEEDED_FLAG = 'starter-skin.cleanings.seeded.v3';

/** Drop entries that don't match the current model (e.g. stale v1 data that
 *  flowed in via a gateway pull) so the UI never renders a malformed cleaning. */
const isValidCleaning = (c: unknown): c is Cleaning => {
  if (!c || typeof c !== 'object') return false;
  const op = (c as Cleaning).operation;
  if (!op) return false;
  if (op.kind === 'clean') return Array.isArray(op.steps);
  return op.kind === 'descale';
};

/**
 * localStorage-backed CleaningRepository. Mirrors the Recipe/Pitcher local
 * repos: small object count, sync storage behind a Promise API; storage
 * injected for tests. Seeds the default cleanings on first run only.
 */
export class LocalCleaningRepository implements CleaningRepository {
  /** @param onChange fired after a user mutation so the library sync can push.
   *   Not fired by `seedIfFirstRun` / `replaceAll` (bootstrap + sync-pull). */
  constructor(
    private readonly storage: Storage = globalThis.localStorage,
    private readonly onChange?: () => void,
  ) {
    this.seedIfFirstRun();
  }

  async list(): Promise<Cleaning[]> {
    return this.readAll();
  }

  async get(id: string): Promise<Cleaning | null> {
    return this.readAll().find((c) => c.id === id) ?? null;
  }

  async create(cleaning: Cleaning): Promise<Cleaning> {
    const all = this.readAll();
    if (all.some((c) => c.id === cleaning.id)) {
      throw new Error(`Cleaning with id "${cleaning.id}" already exists`);
    }
    all.push(cleaning);
    this.writeAll(all);
    this.onChange?.();
    return cleaning;
  }

  async update(cleaning: Cleaning): Promise<Cleaning> {
    const all = this.readAll();
    const idx = all.findIndex((c) => c.id === cleaning.id);
    if (idx === -1) throw new Error(`Cleaning "${cleaning.id}" not found`);
    all[idx] = cleaning;
    this.writeAll(all);
    this.onChange?.();
    return cleaning;
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll();
    const idx = all.findIndex((c) => c.id === id);
    if (idx === -1) return;
    all.splice(idx, 1);
    this.writeAll(all);
    this.onChange?.();
  }

  /** Replace the whole collection — library sync pull. Does not fire onChange. */
  async replaceAll(cleanings: Cleaning[]): Promise<void> {
    this.writeAll(cleanings);
  }

  private seedIfFirstRun(): void {
    if (this.storage.getItem(SEEDED_FLAG) === '1') return;
    if (this.readAll().length === 0) this.writeAll(SEED_CLEANINGS);
    this.storage.setItem(SEEDED_FLAG, '1');
  }

  private readAll(): Cleaning[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Cleaning[];
      return Array.isArray(parsed) ? parsed.filter(isValidCleaning) : [];
    } catch {
      return [];
    }
  }

  private writeAll(cleanings: Cleaning[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(cleanings));
  }
}
