import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalVesselRepository } from './local_vessel_repository';
import { SEED_VESSELS } from './seed_vessels';
import type { Vessel } from '../domain';
import { MemoryStorage } from '../test/memoryStorage';

const sampleVessel = (id: string): Vessel => ({
  id,
  name: `Vessel ${id}`,
  capacityMl: 400,
  flow: 6.0,
});

describe('LocalVesselRepository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('seeding', () => {
    it('seeds the cup + mug defaults on first run', async () => {
      const repo = new LocalVesselRepository(storage);
      const all = await repo.list();
      expect(all).toHaveLength(SEED_VESSELS.length);
      expect(all.map((v) => v.name)).toEqual(['Cup', 'Mug']);
    });

    it('does not re-seed on second construction', async () => {
      new LocalVesselRepository(storage);
      const repo2 = new LocalVesselRepository(storage);
      expect(await repo2.list()).toHaveLength(SEED_VESSELS.length);
    });

    it('does not re-seed after the user empties the library', async () => {
      const repo = new LocalVesselRepository(storage);
      for (const v of await repo.list()) await repo.delete(v.id);
      expect(await repo.list()).toHaveLength(0);

      const repo2 = new LocalVesselRepository(storage);
      expect(await repo2.list()).toHaveLength(0);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back a vessel', async () => {
      const repo = new LocalVesselRepository(storage);
      await repo.create(sampleVessel('v1'));
      expect(await repo.get('v1')).toMatchObject({ id: 'v1', capacityMl: 400 });
    });

    it('rejects a duplicate id', async () => {
      const repo = new LocalVesselRepository(storage);
      await repo.create(sampleVessel('v1'));
      await expect(repo.create(sampleVessel('v1'))).rejects.toThrow();
    });

    it('updates an existing vessel', async () => {
      const repo = new LocalVesselRepository(storage);
      await repo.create(sampleVessel('v1'));
      await repo.update({ ...sampleVessel('v1'), capacityMl: 750 });
      expect((await repo.get('v1'))?.capacityMl).toBe(750);
    });

    it('deletes a vessel', async () => {
      const repo = new LocalVesselRepository(storage);
      await repo.create(sampleVessel('v1'));
      await repo.delete('v1');
      expect(await repo.get('v1')).toBeNull();
    });
  });

  describe('sync hooks', () => {
    it('fires onChange for user mutations but not for replaceAll', async () => {
      const onChange = vi.fn();
      const repo = new LocalVesselRepository(storage, onChange);
      // Construction seeds — that must not count as a user mutation.
      expect(onChange).not.toHaveBeenCalled();

      await repo.create(sampleVessel('v1'));
      await repo.update({ ...sampleVessel('v1'), flow: 4 });
      await repo.delete('v1');
      expect(onChange).toHaveBeenCalledTimes(3);

      onChange.mockClear();
      await repo.replaceAll([sampleVessel('v2')]);
      expect(onChange).not.toHaveBeenCalled();
      expect(await repo.list()).toHaveLength(1);
    });
  });
});
