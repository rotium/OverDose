import type { Recipe } from '../domain';

/**
 * Seed Recipes — one per seed Routine so the Home picker isn't empty.
 * Each references its parent Routine by id and starts with no overrides;
 * the user tunes bean/grind/weight values per Recipe as they discover what
 * each batch wants.
 *
 * Names mirror the Routine they reference for the first-run experience;
 * users will rename as they create more variants ("Wife's Cappuccino",
 * "Indonesia X", …) per the recipe-of-a-routine mental model.
 */
export const SEED_RECIPES: Recipe[] = [
  {
    id: 'seed-rec-espresso',
    name: 'Espresso',
    routineId: 'seed-bev-espresso',
    overrides: {},
  },
  {
    id: 'seed-rec-cappuccino',
    name: 'Cappuccino',
    routineId: 'seed-bev-cappuccino',
    overrides: {},
  },
  {
    id: 'seed-rec-americano',
    name: 'Americano',
    routineId: 'seed-bev-americano',
    overrides: {},
  },
  {
    id: 'seed-rec-flat-white',
    name: 'Flat White',
    routineId: 'seed-bev-flat-white',
    overrides: {},
  },
  {
    id: 'seed-rec-latte',
    name: 'Latte',
    routineId: 'seed-bev-latte',
    overrides: {},
  },
];
