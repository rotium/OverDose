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
 */
export const SEED_BEVERAGES: Beverage[] = [
  {
    id: 'seed-bev-espresso',
    name: 'Espresso',
    steps: [
      beverageStep(
        'brew',
        { targetYieldGrams: 36, stopAtWeight: true },
        'seed-bev-espresso-brew',
      ),
    ],
  },
  {
    id: 'seed-bev-cappuccino',
    name: 'Cappuccino',
    steps: [
      beverageStep(
        'brew',
        { targetYieldGrams: 36, stopAtWeight: true },
        'seed-bev-cappuccino-brew',
      ),
      beverageStep('flush', {}, 'seed-bev-cappuccino-flush'),
      beverageStep(
        'steam',
        { durationSec: 30, autoPurgeTimeSec: 5 },
        'seed-bev-cappuccino-steam',
      ),
    ],
  },
  {
    id: 'seed-bev-americano',
    name: 'Americano',
    steps: [
      beverageStep(
        'brew',
        { targetYieldGrams: 36, stopAtWeight: true },
        'seed-bev-americano-brew',
      ),
      beverageStep('water', { volumeMl: 120 }, 'seed-bev-americano-water'),
    ],
  },
  {
    id: 'seed-bev-flat-white',
    name: 'Flat White',
    steps: [
      beverageStep(
        'brew',
        { targetYieldGrams: 40, stopAtWeight: true },
        'seed-bev-flat-white-brew',
      ),
      beverageStep('flush', {}, 'seed-bev-flat-white-flush'),
      beverageStep(
        'steam',
        { durationSec: 20, autoPurgeTimeSec: 5 },
        'seed-bev-flat-white-steam',
      ),
    ],
  },
  {
    id: 'seed-bev-latte',
    name: 'Latte',
    steps: [
      beverageStep(
        'brew',
        { targetYieldGrams: 36, stopAtWeight: true },
        'seed-bev-latte-brew',
      ),
      beverageStep('flush', {}, 'seed-bev-latte-flush'),
      beverageStep(
        'steam',
        { durationSec: 35, autoPurgeTimeSec: 5 },
        'seed-bev-latte-steam',
      ),
    ],
  },
];
