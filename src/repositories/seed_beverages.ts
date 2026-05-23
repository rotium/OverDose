import { beverageStep } from '../domain';
import type { Beverage } from '../domain';

/**
 * Seed Beverages shipped on first run. IDs are stable so a re-seed never
 * collides with user data. Per-step ids are also stable so seed Recipes
 * can reference them by id from a separate file.
 *
 * Each Beverage carries the structural sequence + Beverage-level defaults
 * (target weights, yields, durations). Seed Recipes that reference these
 * Beverages start with no overrides — users add overrides as they tune
 * specific bean/batch values.
 */
export const SEED_BEVERAGES: Beverage[] = [
  {
    id: 'seed-bev-espresso',
    name: 'Espresso',
    steps: [
      beverageStep('bean-selection', {}, 'seed-bev-espresso-bean'),
      beverageStep('profile-selection', {}, 'seed-bev-espresso-profile'),
      beverageStep('grind', {}, 'seed-bev-espresso-grind'),
      beverageStep('weight', { targetGrams: 18 }, 'seed-bev-espresso-weight'),
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
      beverageStep('bean-selection', {}, 'seed-bev-cappuccino-bean'),
      beverageStep('profile-selection', {}, 'seed-bev-cappuccino-profile'),
      beverageStep('grind', {}, 'seed-bev-cappuccino-grind'),
      beverageStep('weight', { targetGrams: 18 }, 'seed-bev-cappuccino-weight'),
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
      beverageStep('bean-selection', {}, 'seed-bev-americano-bean'),
      beverageStep('profile-selection', {}, 'seed-bev-americano-profile'),
      beverageStep('grind', {}, 'seed-bev-americano-grind'),
      beverageStep('weight', { targetGrams: 18 }, 'seed-bev-americano-weight'),
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
      beverageStep('bean-selection', {}, 'seed-bev-flat-white-bean'),
      beverageStep('profile-selection', {}, 'seed-bev-flat-white-profile'),
      beverageStep('grind', {}, 'seed-bev-flat-white-grind'),
      beverageStep('weight', { targetGrams: 18 }, 'seed-bev-flat-white-weight'),
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
      beverageStep('bean-selection', {}, 'seed-bev-latte-bean'),
      beverageStep('profile-selection', {}, 'seed-bev-latte-profile'),
      beverageStep('grind', {}, 'seed-bev-latte-grind'),
      beverageStep('weight', { targetGrams: 18 }, 'seed-bev-latte-weight'),
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
