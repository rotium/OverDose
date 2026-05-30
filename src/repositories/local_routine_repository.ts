import type { Routine } from '../domain';
import type { RoutineRepository } from './routine_repository';
import { SEED_ROUTINES } from './seed_routines';

const STORAGE_KEY = 'starter-skin.routines.v1';
const SEEDED_FLAG = 'starter-skin.routines.seeded.v1';

/**
 * localStorage-backed RoutineRepository. Mirrors LocalRecipeRepository:
 * small object count, sync API is fine, IndexedDB upgrade later behind the
 * interface. Storage injected so tests get a clean per-run store.
 */
export class LocalRoutineRepository implements RoutineRepository {
  /** @param onChange fired after a user mutation so the library sync can push.
   *   Not fired by `seedIfFirstRun` / `replaceAll` (bootstrap + sync-pull). */
  constructor(
    private readonly storage: Storage = globalThis.localStorage,
    private readonly onChange?: () => void,
  ) {
    this.seedIfFirstRun();
  }

  async list(): Promise<Routine[]> {
    return this.readAll();
  }

  async listVisible(): Promise<Routine[]> {
    return this.readAll().filter((b) => !b.hidden);
  }

  async get(id: string): Promise<Routine | null> {
    return this.readAll().find((b) => b.id === id) ?? null;
  }

  async create(routine: Routine): Promise<Routine> {
    const all = this.readAll();
    if (all.some((b) => b.id === routine.id)) {
      throw new Error(`Routine with id "${routine.id}" already exists`);
    }
    all.push(routine);
    this.writeAll(all);
    this.onChange?.();
    return routine;
  }

  async update(routine: Routine): Promise<Routine> {
    const all = this.readAll();
    const idx = all.findIndex((b) => b.id === routine.id);
    if (idx === -1) throw new Error(`Routine "${routine.id}" not found`);
    all[idx] = routine;
    this.writeAll(all);
    this.onChange?.();
    return routine;
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll();
    const idx = all.findIndex((b) => b.id === id);
    if (idx === -1) return;
    all.splice(idx, 1);
    this.writeAll(all);
    this.onChange?.();
  }

  /** Replace the whole collection (incl. hidden clones) — library sync pull.
   *  Does not fire `onChange`. */
  async replaceAll(routines: Routine[]): Promise<void> {
    this.writeAll(routines);
  }

  private seedIfFirstRun(): void {
    if (this.storage.getItem(SEEDED_FLAG) === '1') return;
    if (this.readAll().length === 0) this.writeAll(SEED_ROUTINES);
    this.storage.setItem(SEEDED_FLAG, '1');
  }

  private readAll(): Routine[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Routine[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(routines: Routine[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(routines));
  }
}
