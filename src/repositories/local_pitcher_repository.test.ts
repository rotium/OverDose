import { beforeEach, describe, expect, it } from 'vitest';
import { LocalPitcherRepository } from './local_pitcher_repository';
import { SEED_PITCHERS } from './seed_pitchers';
import type { Pitcher } from '../domain';
import { MemoryStorage } from '../test/memoryStorage';

const samplePitcher = (id: string): Pitcher => ({
  id,
  name: `Pitcher ${id}`,
  capacityMl: 400,
  steamDurationSec: 35,
  steamTempC: 150,
  steamFlow: 0.9,
});

describe('LocalPitcherRepository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('seeding', () => {
    it('seeds the small + large defaults on first run', async () => {
      const repo = new LocalPitcherRepository(storage);
      const all = await repo.list();
      expect(all).toHaveLength(SEED_PITCHERS.length);
      expect(all.map((p) => p.name)).toEqual(['Small', 'Large']);
    });

    it('does not re-seed on second construction', async () => {
      new LocalPitcherRepository(storage);
      const repo2 = new LocalPitcherRepository(storage);
      expect(await repo2.list()).toHaveLength(SEED_PITCHERS.length);
    });

    it('does not re-seed after the user empties the library', async () => {
      const repo = new LocalPitcherRepository(storage);
      for (const p of await repo.list()) await repo.delete(p.id);
      expect(await repo.list()).toHaveLength(0);

      const repo2 = new LocalPitcherRepository(storage);
      expect(await repo2.list()).toHaveLength(0);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back a pitcher', async () => {
      const repo = new LocalPitcherRepository(storage);
      await repo.create(samplePitcher('p1'));
      expect(await repo.get('p1')).toMatchObject({ id: 'p1', capacityMl: 400 });
    });

    it('rejects a duplicate id', async () => {
      const repo = new LocalPitcherRepository(storage);
      await repo.create(samplePitcher('p1'));
      await expect(repo.create(samplePitcher('p1'))).rejects.toThrow();
    });

    it('updates an existing pitcher', async () => {
      const repo = new LocalPitcherRepository(storage);
      await repo.create(samplePitcher('p1'));
      await repo.update({ ...samplePitcher('p1'), steamDurationSec: 60 });
      expect((await repo.get('p1'))?.steamDurationSec).toBe(60);
    });

    it('deletes a pitcher', async () => {
      const repo = new LocalPitcherRepository(storage);
      await repo.create(samplePitcher('p1'));
      await repo.delete('p1');
      expect(await repo.get('p1')).toBeNull();
    });
  });
});
