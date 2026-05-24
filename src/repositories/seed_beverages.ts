import { beverageStep } from '../domain';
import type { Beverage } from '../domain';

/**
 * Seed Beverages shipped on first run. IDs are stable so a re-seed never
 * collides with user data. Per-step ids are also stable so seed Recipes
 * can reference them by id from a separate file (none do today, but the
 * shape is preserved for future use).
 *
 * Steps are only the machine actions the gateway runs (brew / steam /
 * water / flush). Bean / Profile / Grinder / Dose are Recipe-level and
 * not part of these definitions.
 *
 * Today only the steam step carries a Beverage-level parameter
 * (`autoPurgeTimeSec`); seeds default to a 5-second auto-purge.
 */
export const SEED_BEVERAGES: Beverage[] = [
  {
    id: 'seed-bev-espresso',
    name: 'Espresso',
    steps: [beverageStep('brew', {}, 'seed-bev-espresso-brew')],
  },
  {
    id: 'seed-bev-cappuccino',
    name: 'Cappuccino',
    steps: [
      beverageStep('brew', {}, 'seed-bev-cappuccino-brew'),
      beverageStep('flush', {}, 'seed-bev-cappuccino-flush'),
      beverageStep(
        'steam',
        { autoPurgeTimeSec: 5 },
        'seed-bev-cappuccino-steam',
      ),
    ],
  },
  {
    id: 'seed-bev-americano',
    name: 'Americano',
    steps: [
      beverageStep('brew', {}, 'seed-bev-americano-brew'),
      beverageStep('water', {}, 'seed-bev-americano-water'),
    ],
  },
  {
    id: 'seed-bev-flat-white',
    name: 'Flat White',
    steps: [
      beverageStep('brew', {}, 'seed-bev-flat-white-brew'),
      beverageStep('flush', {}, 'seed-bev-flat-white-flush'),
      beverageStep(
        'steam',
        { autoPurgeTimeSec: 5 },
        'seed-bev-flat-white-steam',
      ),
    ],
  },
  {
    id: 'seed-bev-latte',
    name: 'Latte',
    steps: [
      beverageStep('brew', {}, 'seed-bev-latte-brew'),
      beverageStep('flush', {}, 'seed-bev-latte-flush'),
      beverageStep('steam', { autoPurgeTimeSec: 5 }, 'seed-bev-latte-steam'),
    ],
  },
];
