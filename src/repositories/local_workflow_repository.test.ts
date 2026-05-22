import { beforeEach, describe, expect, it } from 'vitest';
import { LocalWorkflowRepository } from './local_workflow_repository';
import { SEED_WORKFLOWS } from './seed_workflows';
import { step } from '../domain';
import type { Workflow } from '../domain';

/** In-memory Storage shim — avoids touching real localStorage in tests. */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

const sampleWorkflow = (id: string): Workflow => ({
  id,
  name: `WF ${id}`,
  pipeline: {
    id: `pipe-${id}`,
    name: 'p',
    steps: [step('brew', { durationSec: 30 })],
  },
});

describe('LocalWorkflowRepository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('seeding', () => {
    it('seeds defaults on first run', async () => {
      const repo = new LocalWorkflowRepository(storage);
      expect(await repo.list()).toHaveLength(SEED_WORKFLOWS.length);
    });

    it('does not re-seed on second construction', async () => {
      new LocalWorkflowRepository(storage);
      const repo2 = new LocalWorkflowRepository(storage);
      expect(await repo2.list()).toHaveLength(SEED_WORKFLOWS.length);
    });

    it('does not re-seed after the user empties the library', async () => {
      const repo = new LocalWorkflowRepository(storage);
      for (const w of await repo.list()) await repo.delete(w.id);
      expect(await repo.list()).toHaveLength(0);

      const repo2 = new LocalWorkflowRepository(storage);
      expect(await repo2.list()).toHaveLength(0);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back a workflow', async () => {
      const repo = new LocalWorkflowRepository(storage);
      const wf = sampleWorkflow('a');
      await repo.create(wf);
      expect(await repo.get('a')).toEqual(wf);
    });

    it('rejects creating a duplicate id', async () => {
      const repo = new LocalWorkflowRepository(storage);
      await repo.create(sampleWorkflow('a'));
      await expect(repo.create(sampleWorkflow('a'))).rejects.toThrow(/already exists/);
    });

    it('updates an existing workflow', async () => {
      const repo = new LocalWorkflowRepository(storage);
      await repo.create(sampleWorkflow('a'));
      await repo.update({ ...sampleWorkflow('a'), name: 'renamed' });
      const got = await repo.get('a');
      expect(got?.name).toBe('renamed');
    });

    it('rejects updating an unknown id', async () => {
      const repo = new LocalWorkflowRepository(storage);
      await expect(repo.update(sampleWorkflow('missing'))).rejects.toThrow(/not found/);
    });

    it('deletes by id', async () => {
      const repo = new LocalWorkflowRepository(storage);
      await repo.create(sampleWorkflow('a'));
      await repo.delete('a');
      expect(await repo.get('a')).toBeNull();
    });

    it('silently ignores delete of an unknown id', async () => {
      const repo = new LocalWorkflowRepository(storage);
      await expect(repo.delete('missing')).resolves.toBeUndefined();
    });

    it('returns null when reading an unknown id', async () => {
      const repo = new LocalWorkflowRepository(storage);
      expect(await repo.get('missing')).toBeNull();
    });
  });

  describe('storage corruption', () => {
    it('recovers from garbage data by returning empty list', async () => {
      storage.setItem('starter-skin.workflows.v1', '{not json');
      storage.setItem('starter-skin.workflows.seeded.v1', '1');
      const repo = new LocalWorkflowRepository(storage);
      expect(await repo.list()).toEqual([]);
    });
  });
});
