import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBeverageRepository } from './local_beverage_repository';
import { SEED_BEVERAGES } from './seed_beverages';
import { beverageStep } from '../domain';
import type { Beverage } from '../domain';
import { MemoryStorage } from '../test/memoryStorage';

const sampleBeverage = (id: string, over: Partial<Beverage> = {}): Beverage => ({
  id,
  name: `Beverage ${id}`,
  steps: [beverageStep('brew', { durationSec: 30 })],
  ...over,
});

describe('LocalBeverageRepository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('seeding', () => {
    it('seeds defaults on first run', async () => {
      const repo = new LocalBeverageRepository(storage);
      expect(await repo.list()).toHaveLength(SEED_BEVERAGES.length);
    });

    it('does not re-seed on second construction', async () => {
      new LocalBeverageRepository(storage);
      const repo2 = new LocalBeverageRepository(storage);
      expect(await repo2.list()).toHaveLength(SEED_BEVERAGES.length);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back a beverage', async () => {
      const repo = new LocalBeverageRepository(storage);
      const b = sampleBeverage('a');
      await repo.create(b);
      expect(await repo.get('a')).toEqual(b);
    });

    it('rejects creating a duplicate id', async () => {
      const repo = new LocalBeverageRepository(storage);
      await repo.create(sampleBeverage('a'));
      await expect(repo.create(sampleBeverage('a'))).rejects.toThrow(/already exists/);
    });

    it('updates an existing beverage', async () => {
      const repo = new LocalBeverageRepository(storage);
      await repo.create(sampleBeverage('a'));
      await repo.update({ ...sampleBeverage('a'), name: 'renamed' });
      expect((await repo.get('a'))?.name).toBe('renamed');
    });

    it('deletes by id', async () => {
      const repo = new LocalBeverageRepository(storage);
      await repo.create(sampleBeverage('a'));
      await repo.delete('a');
      expect(await repo.get('a')).toBeNull();
    });
  });

  describe('hidden flag', () => {
    it('listVisible() filters out hidden beverages', async () => {
      const repo = new LocalBeverageRepository(storage);
      const seedCount = (await repo.list()).length;

      await repo.create(sampleBeverage('hidden-1', { hidden: true }));
      await repo.create(sampleBeverage('visible-1'));

      expect(await repo.list()).toHaveLength(seedCount + 2);
      const visible = await repo.listVisible();
      expect(visible).toHaveLength(seedCount + 1);
      expect(visible.find((b) => b.id === 'hidden-1')).toBeUndefined();
      expect(visible.find((b) => b.id === 'visible-1')).toBeDefined();
    });

    it('list() (no filter) returns hidden beverages too — used by the runtime', async () => {
      const repo = new LocalBeverageRepository(storage);
      await repo.create(sampleBeverage('hidden-1', { hidden: true }));
      expect(await repo.get('hidden-1')).not.toBeNull();
    });
  });
});
