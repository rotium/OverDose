import { routineStep } from '../domain';
import type { Routine } from '../domain';

/**
 * Seed Routines shipped on first run. IDs are stable so a re-seed never
 * collides with user data. Per-step ids are also stable so seed Recipes
 * can reference them by id from a separate file (none do today, but the
 * shape is preserved for future use).
 *
 * Steps are only the machine actions the gateway runs (brew / steam /
 * water / flush). Bean / Profile / Grinder / Dose are Recipe-level and
 * not part of these definitions. No step type carries a Routine-level
 * field today.
 */
export const SEED_ROUTINES: Routine[] = [
  {
    id: 'seed-bev-espresso',
    name: 'Espresso',
    steps: [routineStep('brew', {}, 'seed-bev-espresso-brew')],
  },
  {
    id: 'seed-bev-cappuccino',
    name: 'Cappuccino',
    steps: [
      routineStep('brew', {}, 'seed-bev-cappuccino-brew'),
      routineStep('flush', {}, 'seed-bev-cappuccino-flush'),
      routineStep('steam', {}, 'seed-bev-cappuccino-steam'),
    ],
  },
  {
    id: 'seed-bev-americano',
    name: 'Americano',
    steps: [
      routineStep('brew', {}, 'seed-bev-americano-brew'),
      routineStep('water', {}, 'seed-bev-americano-water'),
    ],
  },
  {
    id: 'seed-bev-flat-white',
    name: 'Flat White',
    steps: [
      routineStep('brew', {}, 'seed-bev-flat-white-brew'),
      routineStep('flush', {}, 'seed-bev-flat-white-flush'),
      routineStep('steam', {}, 'seed-bev-flat-white-steam'),
    ],
  },
  {
    id: 'seed-bev-latte',
    name: 'Latte',
    steps: [
      routineStep('brew', {}, 'seed-bev-latte-brew'),
      routineStep('flush', {}, 'seed-bev-latte-flush'),
      routineStep('steam', {}, 'seed-bev-latte-steam'),
    ],
  },
];
