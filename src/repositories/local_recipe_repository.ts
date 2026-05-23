import type { Recipe } from '../domain';
import type { RecipeRepository } from './recipe_repository';
import { SEED_RECIPES } from './seed_recipes';

const STORAGE_KEY = 'starter-skin.recipes.v1';
const SEEDED_FLAG = 'starter-skin.recipes.seeded.v1';

/**
 * localStorage-backed RecipeRepository (was LocalWorkflowRepository).
 * Small object count, sync API is adequate; IndexedDB upgrade later behind
 * the interface. Storage injected for tests.
 */
export class LocalRecipeRepository implements RecipeRepository {
  constructor(private readonly storage: Storage = globalThis.localStorage) {
    this.seedIfFirstRun();
  }

  async list(): Promise<Recipe[]> {
    return this.readAll();
  }

  async get(id: string): Promise<Recipe | null> {
    return this.readAll().find((r) => r.id === id) ?? null;
  }

  async create(recipe: Recipe): Promise<Recipe> {
    const all = this.readAll();
    if (all.some((r) => r.id === recipe.id)) {
      throw new Error(`Recipe with id "${recipe.id}" already exists`);
    }
    all.push(recipe);
    this.writeAll(all);
    return recipe;
  }

  async update(recipe: Recipe): Promise<Recipe> {
    const all = this.readAll();
    const idx = all.findIndex((r) => r.id === recipe.id);
    if (idx === -1) throw new Error(`Recipe "${recipe.id}" not found`);
    all[idx] = recipe;
    this.writeAll(all);
    return recipe;
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return;
    all.splice(idx, 1);
    this.writeAll(all);
  }

  private seedIfFirstRun(): void {
    if (this.storage.getItem(SEEDED_FLAG) === '1') return;
    if (this.readAll().length === 0) this.writeAll(SEED_RECIPES);
    this.storage.setItem(SEEDED_FLAG, '1');
  }

  private readAll(): Recipe[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Recipe[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(recipes: Recipe[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(recipes));
  }
}
