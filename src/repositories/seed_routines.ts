import { routineStep } from '../domain';
import type { Routine } from '../domain';

/**
 * Seed Routines shipped on first run. A Routine is the **generic machine-step
 * structure**, not a named drink — the named drinks (Espresso, Cappuccino,
 * Latte, …) are seed *Recipes* that reference these (see `seed_recipes.ts`).
 * So there's one Routine per distinct step sequence, not one per drink:
 *
 *   Brew          — brew                (espresso shots)
 *   Brew + Steam  — brew → steam        (milk drinks: cappuccino, latte, …)
 *   Brew + Water  — brew → water        (americano)
 *
 * Steps are only the machine actions the gateway runs (brew / steam / water /
 * flush). Bean / Profile / Grinder / Dose are Recipe-level. No step type
 * carries a Routine-level field today. IDs are stable so a re-seed never
 * collides with user data, and per-step ids are stable so Recipe overrides
 * key against them.
 */
export const SEED_ROUTINES: Routine[] = [
  {
    id: 'seed-routine-brew',
    name: 'Brew',
    steps: [routineStep('brew', {}, 'seed-routine-brew-1')],
  },
  {
    id: 'seed-routine-brew-steam',
    name: 'Brew + Steam',
    steps: [
      routineStep('brew', {}, 'seed-routine-brew-steam-1'),
      routineStep('steam', {}, 'seed-routine-brew-steam-2'),
    ],
  },
  {
    id: 'seed-routine-brew-water',
    name: 'Brew + Water',
    steps: [
      routineStep('brew', {}, 'seed-routine-brew-water-1'),
      routineStep('water', {}, 'seed-routine-brew-water-2'),
    ],
  },
];
