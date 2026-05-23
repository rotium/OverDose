import type { Recipe } from '../domain';

/**
 * Seed Recipes — one per seed Beverage so the Home picker isn't empty.
 * Each references its parent Beverage by id and starts with no overrides;
 * the user tunes bean/grind/weight values per Recipe as they discover what
 * each batch wants.
 *
 * Names mirror the Beverage they reference for the first-run experience;
 * users will rename as they create more variants ("Wife's Cappuccino",
 * "Indonesia X", …) per the recipe-of-a-beverage mental model.
 */
export const SEED_RECIPES: Recipe[] = [
  {
    id: 'seed-rec-espresso',
    name: 'Espresso',
    beverageId: 'seed-bev-espresso',
    overrides: {},
  },
  {
    id: 'seed-rec-cappuccino',
    name: 'Cappuccino',
    beverageId: 'seed-bev-cappuccino',
    overrides: {},
  },
  {
    id: 'seed-rec-americano',
    name: 'Americano',
    beverageId: 'seed-bev-americano',
    overrides: {},
  },
  {
    id: 'seed-rec-flat-white',
    name: 'Flat White',
    beverageId: 'seed-bev-flat-white',
    overrides: {},
  },
  {
    id: 'seed-rec-latte',
    name: 'Latte',
    beverageId: 'seed-bev-latte',
    overrides: {},
  },
];
