import type { Recipe } from '../domain';

/**
 * Repository for Recipes (was WorkflowRepository). Recipes reference a
 * Beverage by id and carry per-step overrides; storage is per-Recipe and
 * the resolution chain reads the Beverage via [[BeverageRepository]].
 *
 * Promise-returning so the gateway-backed swap-in later doesn't require
 * call-site changes (see [[starter-skin-storage]]).
 */
export interface RecipeRepository {
  list(): Promise<Recipe[]>;
  /** Recipes shown on the Home picker — excludes ones the user has hidden
   *  (`Recipe.hidden`). The Library uses `list()` so hidden recipes stay
   *  visible (dimmed) there for un-hiding. */
  listVisible(): Promise<Recipe[]>;
  get(id: string): Promise<Recipe | null>;
  create(recipe: Recipe): Promise<Recipe>;
  update(recipe: Recipe): Promise<Recipe>;
  delete(id: string): Promise<void>;
  /** Replace the whole collection in one shot — used by the library sync to
   *  adopt the gateway's copy on pull. See docs/storage-sync.md. */
  replaceAll(recipes: Recipe[]): Promise<void>;
}
