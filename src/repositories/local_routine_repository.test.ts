import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRoutineRepository } from './local_routine_repository';
import { SEED_ROUTINES } from './seed_routines';
import { routineStep } from '../domain';
import type { Routine } from '../domain';
import { MemoryStorage } from '../test/memoryStorage';

const sampleRoutine = (id: string, over: Partial<Routine> = {}): Routine => ({
  id,
  name: `Routine ${id}`,
  steps: [routineStep('brew', {})],
  ...over,
});

describe('LocalRoutineRepository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('seeding', () => {
    it('seeds defaults on first run', async () => {
      const repo = new LocalRoutineRepository(storage);
      expect(await repo.list()).toHaveLength(SEED_ROUTINES.length);
    });

    it('does not re-seed on second construction', async () => {
      new LocalRoutineRepository(storage);
      const repo2 = new LocalRoutineRepository(storage);
      expect(await repo2.list()).toHaveLength(SEED_ROUTINES.length);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back a routine', async () => {
      const repo = new LocalRoutineRepository(storage);
      const b = sampleRoutine('a');
      await repo.create(b);
      expect(await repo.get('a')).toEqual(b);
    });

    it('rejects creating a duplicate id', async () => {
      const repo = new LocalRoutineRepository(storage);
      await repo.create(sampleRoutine('a'));
      await expect(repo.create(sampleRoutine('a'))).rejects.toThrow(/already exists/);
    });

    it('updates an existing routine', async () => {
      const repo = new LocalRoutineRepository(storage);
      await repo.create(sampleRoutine('a'));
      await repo.update({ ...sampleRoutine('a'), name: 'renamed' });
      expect((await repo.get('a'))?.name).toBe('renamed');
    });

    it('deletes by id', async () => {
      const repo = new LocalRoutineRepository(storage);
      await repo.create(sampleRoutine('a'));
      await repo.delete('a');
      expect(await repo.get('a')).toBeNull();
    });
  });

  describe('hidden flag', () => {
    it('listVisible() filters out hidden routines', async () => {
      const repo = new LocalRoutineRepository(storage);
      const seedCount = (await repo.list()).length;

      await repo.create(sampleRoutine('hidden-1', { hidden: true }));
      await repo.create(sampleRoutine('visible-1'));

      expect(await repo.list()).toHaveLength(seedCount + 2);
      const visible = await repo.listVisible();
      expect(visible).toHaveLength(seedCount + 1);
      expect(visible.find((b) => b.id === 'hidden-1')).toBeUndefined();
      expect(visible.find((b) => b.id === 'visible-1')).toBeDefined();
    });

    it('list() (no filter) returns hidden routines too — used by the runtime', async () => {
      const repo = new LocalRoutineRepository(storage);
      await repo.create(sampleRoutine('hidden-1', { hidden: true }));
      expect(await repo.get('hidden-1')).not.toBeNull();
    });
  });
});
