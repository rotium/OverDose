import { step } from '../domain';
import type { Workflow } from '../domain';

/**
 * Seed Workflows shipped on first run so the picker isn't empty. Users can
 * edit, duplicate, or delete them from the library. IDs are stable so a
 * re-seed never collides with user data.
 */
export const SEED_WORKFLOWS: Workflow[] = [
  {
    id: 'seed-espresso',
    name: 'Espresso',
    pipeline: {
      id: 'seed-pipeline-espresso',
      name: 'Espresso',
      steps: [
        step('bean-selection', {}),
        step('profile-selection', {}),
        step('grind', {}),
        step('weight', { targetGrams: 18 }),
        step('brew', { targetYieldGrams: 36, stopAtWeight: true }),
      ],
    },
  },
  {
    id: 'seed-cappuccino',
    name: 'Cappuccino',
    pipeline: {
      id: 'seed-pipeline-cappuccino',
      name: 'Cappuccino',
      steps: [
        step('bean-selection', {}),
        step('profile-selection', {}),
        step('grind', {}),
        step('weight', { targetGrams: 18 }),
        step('brew', { targetYieldGrams: 36, stopAtWeight: true }),
        step('flush', {}),
        step('steam', { durationSec: 30 }),
      ],
    },
  },
  {
    id: 'seed-americano',
    name: 'Americano',
    pipeline: {
      id: 'seed-pipeline-americano',
      name: 'Americano',
      steps: [
        step('bean-selection', {}),
        step('profile-selection', {}),
        step('grind', {}),
        step('weight', { targetGrams: 18 }),
        step('brew', { targetYieldGrams: 36, stopAtWeight: true }),
        step('water', { volumeMl: 120 }),
      ],
    },
  },
  {
    id: 'seed-flat-white',
    name: 'Flat White',
    pipeline: {
      id: 'seed-pipeline-flat-white',
      name: 'Flat White',
      steps: [
        step('bean-selection', {}),
        step('profile-selection', {}),
        step('grind', {}),
        step('weight', { targetGrams: 18 }),
        step('brew', { targetYieldGrams: 40, stopAtWeight: true }),
        step('flush', {}),
        step('steam', { durationSec: 20 }),
      ],
    },
  },
  {
    id: 'seed-latte',
    name: 'Latte',
    pipeline: {
      id: 'seed-pipeline-latte',
      name: 'Latte',
      steps: [
        step('bean-selection', {}),
        step('profile-selection', {}),
        step('grind', {}),
        step('weight', { targetGrams: 18 }),
        step('brew', { targetYieldGrams: 36, stopAtWeight: true }),
        step('flush', {}),
        step('steam', { durationSec: 35 }),
      ],
    },
  },
];
