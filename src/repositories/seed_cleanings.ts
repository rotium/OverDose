import type { Cleaning } from '../domain';

/**
 * Seed Cleanings shipped on first run so the Library isn't empty. These carry
 * the good multi-pass defaults so users *tweak* rather than build from scratch.
 * IDs (cleaning + step) are stable so a re-seed never duplicates.
 *
 * Coffee-side steps leave `profileId` undefined — that means "the default
 * Cleaning/Forward Flush x5", resolved by title when the step runs (gateway
 * profile ids are content hashes, unknowable at seed time).
 */
export const SEED_CLEANINGS: Cleaning[] = [
  {
    id: 'seed-clean-daily-rinse',
    name: 'Daily Rinse',
    operation: {
      kind: 'clean',
      // Tip soak first so its ~1 h timer runs while you do the group cleaning.
      steps: [
        { id: 'seed-daily-soak', type: 'steamWandSoak' },
        { id: 'seed-daily-cs1', type: 'coffeeSide', withChemical: false },
        { id: 'seed-daily-flush1', type: 'flush', seconds: 5 },
        { id: 'seed-daily-cs2', type: 'coffeeSide', withChemical: false },
        { id: 'seed-daily-flush2', type: 'flush', seconds: 5 },
      ],
    },
    cadence: { byDays: 1 },
  },
  {
    id: 'seed-clean-weekly',
    name: 'Weekly Clean',
    operation: {
      kind: 'clean',
      steps: [
        { id: 'seed-weekly-cs1', type: 'coffeeSide', withChemical: true },
        { id: 'seed-weekly-flush1', type: 'flush', seconds: 5 },
        { id: 'seed-weekly-cs2', type: 'coffeeSide', withChemical: false },
        { id: 'seed-weekly-flush2', type: 'flush', seconds: 5 },
        { id: 'seed-weekly-sw', type: 'steamWand', withChemical: true },
        { id: 'seed-weekly-tank', type: 'waterTank' },
        { id: 'seed-weekly-thimble', type: 'thimble' },
      ],
    },
    cadence: { byDays: 7, byShots: 50 },
  },
  {
    id: 'seed-clean-steam-wand',
    name: 'Steam Wand',
    operation: {
      kind: 'clean',
      steps: [
        { id: 'seed-sw-sw', type: 'steamWand', withChemical: true },
        { id: 'seed-sw-soak', type: 'steamWandSoak' },
      ],
    },
  },
  {
    id: 'seed-clean-descale',
    name: 'Descale',
    operation: { kind: 'descale', withChemical: true },
    // Off Home by default — descaling is occasional and water-dependent.
    hidden: true,
  },
];
