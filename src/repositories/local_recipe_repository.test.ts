import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRecipeRepository } from './local_recipe_repository';
import { SEED_RECIPES } from './seed_recipes';
import type { Recipe } from '../domain';
import { MemoryStorage } from '../test/memoryStorage';

const sampleRecipe = (id: string): Recipe => ({
  id,
  name: `Recipe ${id}`,
  routineId: 'seed-routine-brew',
  overrides: {},
});

describe('LocalRecipeRepository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('seeding', () => {
    it('seeds defaults on first run', async () => {
      const repo = new LocalRecipeRepository(storage);
      expect(await repo.list()).toHaveLength(SEED_RECIPES.length);
    });

    it('does not re-seed on second construction', async () => {
      new LocalRecipeRepository(storage);
      const repo2 = new LocalRecipeRepository(storage);
      expect(await repo2.list()).toHaveLength(SEED_RECIPES.length);
    });

    it('does not re-seed after the user empties the library', async () => {
      const repo = new LocalRecipeRepository(storage);
      for (const r of await repo.list()) await repo.delete(r.id);
      expect(await repo.list()).toHaveLength(0);

      const repo2 = new LocalRecipeRepository(storage);
      expect(await repo2.list()).toHaveLength(0);
    });
  });

  describe('CRUD', () => {
    it('creates and reads back a recipe', async () => {
      const repo = new LocalRecipeRepository(storage);
      const r = sampleRecipe('a');
      await repo.create(r);
      expect(await repo.get('a')).toEqual(r);
    });

    it('rejects creating a duplicate id', async () => {
      const repo = new LocalRecipeRepository(storage);
      await repo.create(sampleRecipe('a'));
      await expect(repo.create(sampleRecipe('a'))).rejects.toThrow(/already exists/);
    });

    it('updates an existing recipe', async () => {
      const repo = new LocalRecipeRepository(storage);
      await repo.create(sampleRecipe('a'));
      await repo.update({ ...sampleRecipe('a'), name: 'renamed' });
      expect((await repo.get('a'))?.name).toBe('renamed');
    });

    it('rejects updating an unknown id', async () => {
      const repo = new LocalRecipeRepository(storage);
      await expect(repo.update(sampleRecipe('missing'))).rejects.toThrow(/not found/);
    });

    it('deletes by id', async () => {
      const repo = new LocalRecipeRepository(storage);
      await repo.create(sampleRecipe('a'));
      await repo.delete('a');
      expect(await repo.get('a')).toBeNull();
    });

    it('silently ignores delete of an unknown id', async () => {
      const repo = new LocalRecipeRepository(storage);
      await expect(repo.delete('missing')).resolves.toBeUndefined();
    });

    it('returns null when reading an unknown id', async () => {
      const repo = new LocalRecipeRepository(storage);
      expect(await repo.get('missing')).toBeNull();
    });
  });

  describe('listVisible', () => {
    it('excludes hidden recipes; list() still returns them', async () => {
      storage.setItem('starter-skin.recipes.seeded.v1', '1'); // skip seeding
      const repo = new LocalRecipeRepository(storage);
      await repo.create(sampleRecipe('a'));
      await repo.create({ ...sampleRecipe('b'), hidden: true });

      expect((await repo.list()).map((r) => r.id)).toEqual(['a', 'b']);
      expect((await repo.listVisible()).map((r) => r.id)).toEqual(['a']);
    });
  });

  describe('reorder', () => {
    const seedThree = () => {
      storage.setItem('starter-skin.recipes.seeded.v1', '1'); // skip seeding
      const repo = new LocalRecipeRepository(storage);
      return repo;
    };

    it('rewrites the stored array to match the given id order', async () => {
      const repo = seedThree();
      await repo.create(sampleRecipe('a'));
      await repo.create(sampleRecipe('b'));
      await repo.create(sampleRecipe('c'));

      await repo.reorder(['c', 'a', 'b']);
      expect((await repo.list()).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    });

    it('keeps ids missing from the order at the end, in prior order', async () => {
      const repo = seedThree();
      await repo.create(sampleRecipe('a'));
      await repo.create(sampleRecipe('b'));
      await repo.create(sampleRecipe('c'));

      // Only b is named — a and c keep their relative order after it.
      await repo.reorder(['b']);
      expect((await repo.list()).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    });

    it('fires onChange so the new order syncs', async () => {
      storage.setItem('starter-skin.recipes.seeded.v1', '1');
      let changes = 0;
      const repo = new LocalRecipeRepository(storage, () => {
        changes += 1;
      });
      await repo.create(sampleRecipe('a')); // +1
      await repo.create(sampleRecipe('b')); // +1
      changes = 0;
      await repo.reorder(['b', 'a']);
      expect(changes).toBe(1);
    });
  });

  describe('storage corruption', () => {
    it('recovers from garbage data by returning empty list', async () => {
      storage.setItem('starter-skin.recipes.v1', '{not json');
      storage.setItem('starter-skin.recipes.seeded.v1', '1');
      const repo = new LocalRecipeRepository(storage);
      expect(await repo.list()).toEqual([]);
    });
  });
});
