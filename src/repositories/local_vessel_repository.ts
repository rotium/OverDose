import type { Vessel } from '../domain';
import type { VesselRepository } from './vessel_repository';
import { SEED_VESSELS } from './seed_vessels';

const STORAGE_KEY = 'starter-skin.vessels.v1';
const SEEDED_FLAG = 'starter-skin.vessels.seeded.v1';

/**
 * localStorage-backed VesselRepository. Mirrors LocalPitcherRepository: small
 * object count, sync storage behind a Promise API; storage injected for tests.
 * Seeds the two default sizes on first run only.
 */
export class LocalVesselRepository implements VesselRepository {
  /** @param onChange fired after a user mutation so the library sync can push.
   *   Not fired by `seedIfFirstRun` / `replaceAll` (bootstrap + sync-pull). */
  constructor(
    private readonly storage: Storage = globalThis.localStorage,
    private readonly onChange?: () => void,
  ) {
    this.seedIfFirstRun();
  }

  async list(): Promise<Vessel[]> {
    return this.readAll();
  }

  async get(id: string): Promise<Vessel | null> {
    return this.readAll().find((v) => v.id === id) ?? null;
  }

  async create(vessel: Vessel): Promise<Vessel> {
    const all = this.readAll();
    if (all.some((v) => v.id === vessel.id)) {
      throw new Error(`Vessel with id "${vessel.id}" already exists`);
    }
    all.push(vessel);
    this.writeAll(all);
    this.onChange?.();
    return vessel;
  }

  async update(vessel: Vessel): Promise<Vessel> {
    const all = this.readAll();
    const idx = all.findIndex((v) => v.id === vessel.id);
    if (idx === -1) throw new Error(`Vessel "${vessel.id}" not found`);
    all[idx] = vessel;
    this.writeAll(all);
    this.onChange?.();
    return vessel;
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll();
    const idx = all.findIndex((v) => v.id === id);
    if (idx === -1) return;
    all.splice(idx, 1);
    this.writeAll(all);
    this.onChange?.();
  }

  /** Replace the whole collection — library sync pull. Does not fire onChange. */
  async replaceAll(vessels: Vessel[]): Promise<void> {
    this.writeAll(vessels);
  }

  private seedIfFirstRun(): void {
    if (this.storage.getItem(SEEDED_FLAG) === '1') return;
    if (this.readAll().length === 0) this.writeAll(SEED_VESSELS);
    this.storage.setItem(SEEDED_FLAG, '1');
  }

  private readAll(): Vessel[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Vessel[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(vessels: Vessel[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(vessels));
  }
}
