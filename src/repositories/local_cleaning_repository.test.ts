import { beforeEach, describe, expect, it } from 'vitest';
import { LocalCleaningRepository } from './local_cleaning_repository';
import { SEED_CLEANINGS } from './seed_cleanings';
import type { Cleaning } from '../domain';
import { MemoryStorage } from '../test/memoryStorage';

const sample = (id: string): Cleaning => ({
  id,
  name: `Cleaning ${id}`,
  operation: { kind: 'profile', withChemical: false },
});

describe('LocalCleaningRepository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('seeding', () => {
    it('seeds the defaults on first run', async () => {
      const repo = new LocalCleaningRepository(storage);
      const all = await repo.list();
      expect(all).toHaveLength(SEED_CLEANINGS.length);
      expect(all.map((c) => c.name)).toEqual([
        'Daily Rinse',
        'Weekly Group Clean',
        'Descale',
      ]);
    });

    it('does not re-seed on second construction', async () => {
      new LocalCleaningRepository(storage);
      const repo2 = new LocalCleaningRepository(storage);
      expect(await repo2.list()).toHaveLength(SEED_CLEANINGS.length);
    });

    it('does not re-seed after the user empties the library', async () => {
      const repo = new LocalCleaningRepository(storage);
      for (const c of await repo.list()) await repo.delete(c.id);
      expect(await repo.list()).toHaveLength(0);
      const repo2 = new LocalCleaningRepository(storage);
      expect(await repo2.list()).toHaveLength(0);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back a cleaning', async () => {
      const repo = new LocalCleaningRepository(storage);
      await repo.create(sample('c1'));
      expect(await repo.get('c1')).toMatchObject({
        id: 'c1',
        operation: { kind: 'profile' },
      });
    });

    it('rejects a duplicate id', async () => {
      const repo = new LocalCleaningRepository(storage);
      await repo.create(sample('c1'));
      await expect(repo.create(sample('c1'))).rejects.toThrow();
    });

    it('updates an existing cleaning', async () => {
      const repo = new LocalCleaningRepository(storage);
      await repo.create(sample('c1'));
      await repo.update({
        ...sample('c1'),
        operation: { kind: 'descale', withChemical: true },
      });
      expect((await repo.get('c1'))?.operation.kind).toBe('descale');
    });

    it('deletes a cleaning', async () => {
      const repo = new LocalCleaningRepository(storage);
      await repo.create(sample('c1'));
      await repo.delete('c1');
      expect(await repo.get('c1')).toBeNull();
    });
  });
});
