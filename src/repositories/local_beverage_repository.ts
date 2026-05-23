import type { Beverage } from '../domain';
import type { BeverageRepository } from './beverage_repository';
import { SEED_BEVERAGES } from './seed_beverages';

const STORAGE_KEY = 'starter-skin.beverages.v1';
const SEEDED_FLAG = 'starter-skin.beverages.seeded.v1';

/**
 * localStorage-backed BeverageRepository. Mirrors LocalRecipeRepository:
 * small object count, sync API is fine, IndexedDB upgrade later behind the
 * interface. Storage injected so tests get a clean per-run store.
 */
export class LocalBeverageRepository implements BeverageRepository {
  constructor(private readonly storage: Storage = globalThis.localStorage) {
    this.seedIfFirstRun();
  }

  async list(): Promise<Beverage[]> {
    return this.readAll();
  }

  async listVisible(): Promise<Beverage[]> {
    return this.readAll().filter((b) => !b.hidden);
  }

  async get(id: string): Promise<Beverage | null> {
    return this.readAll().find((b) => b.id === id) ?? null;
  }

  async create(beverage: Beverage): Promise<Beverage> {
    const all = this.readAll();
    if (all.some((b) => b.id === beverage.id)) {
      throw new Error(`Beverage with id "${beverage.id}" already exists`);
    }
    all.push(beverage);
    this.writeAll(all);
    return beverage;
  }

  async update(beverage: Beverage): Promise<Beverage> {
    const all = this.readAll();
    const idx = all.findIndex((b) => b.id === beverage.id);
    if (idx === -1) throw new Error(`Beverage "${beverage.id}" not found`);
    all[idx] = beverage;
    this.writeAll(all);
    return beverage;
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll();
    const idx = all.findIndex((b) => b.id === id);
    if (idx === -1) return;
    all.splice(idx, 1);
    this.writeAll(all);
  }

  private seedIfFirstRun(): void {
    if (this.storage.getItem(SEEDED_FLAG) === '1') return;
    if (this.readAll().length === 0) this.writeAll(SEED_BEVERAGES);
    this.storage.setItem(SEEDED_FLAG, '1');
  }

  private readAll(): Beverage[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Beverage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(beverages: Beverage[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(beverages));
  }
}
