import type { Pitcher } from '../domain';
import type { PitcherRepository } from './pitcher_repository';
import { SEED_PITCHERS } from './seed_pitchers';

const STORAGE_KEY = 'starter-skin.pitchers.v1';
const SEEDED_FLAG = 'starter-skin.pitchers.seeded.v1';

/**
 * localStorage-backed PitcherRepository. Mirrors the Recipe/Routine local
 * repos: small object count, sync storage behind a Promise API; storage
 * injected for tests. Seeds the two default jugs on first run only.
 */
export class LocalPitcherRepository implements PitcherRepository {
  /** @param onChange fired after a user mutation so the library sync can push.
   *   Not fired by `seedIfFirstRun` / `replaceAll` (bootstrap + sync-pull). */
  constructor(
    private readonly storage: Storage = globalThis.localStorage,
    private readonly onChange?: () => void,
  ) {
    this.seedIfFirstRun();
  }

  async list(): Promise<Pitcher[]> {
    return this.readAll();
  }

  async get(id: string): Promise<Pitcher | null> {
    return this.readAll().find((p) => p.id === id) ?? null;
  }

  async create(pitcher: Pitcher): Promise<Pitcher> {
    const all = this.readAll();
    if (all.some((p) => p.id === pitcher.id)) {
      throw new Error(`Pitcher with id "${pitcher.id}" already exists`);
    }
    all.push(pitcher);
    this.writeAll(all);
    this.onChange?.();
    return pitcher;
  }

  async update(pitcher: Pitcher): Promise<Pitcher> {
    const all = this.readAll();
    const idx = all.findIndex((p) => p.id === pitcher.id);
    if (idx === -1) throw new Error(`Pitcher "${pitcher.id}" not found`);
    all[idx] = pitcher;
    this.writeAll(all);
    this.onChange?.();
    return pitcher;
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll();
    const idx = all.findIndex((p) => p.id === id);
    if (idx === -1) return;
    all.splice(idx, 1);
    this.writeAll(all);
    this.onChange?.();
  }

  /** Replace the whole collection — library sync pull. Does not fire onChange. */
  async replaceAll(pitchers: Pitcher[]): Promise<void> {
    this.writeAll(pitchers);
  }

  private seedIfFirstRun(): void {
    if (this.storage.getItem(SEEDED_FLAG) === '1') return;
    if (this.readAll().length === 0) this.writeAll(SEED_PITCHERS);
    this.storage.setItem(SEEDED_FLAG, '1');
  }

  private readAll(): Pitcher[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Pitcher[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(pitchers: Pitcher[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(pitchers));
  }
}
