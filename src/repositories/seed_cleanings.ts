import type { Cleaning } from '../domain';

/**
 * Seed Cleanings shipped on first run so the Library isn't empty. The two
 * Forward-Flush entries differ only by `withChemical` (daily rinse vs weekly
 * Cafiza clean) and their cadence — the same profile backs both. Descale ships
 * with reminders off (it's water-dependent). IDs are stable so a re-seed never
 * duplicates.
 *
 * Profile cleanings ship without a `profileId`: a profile is a gateway-owned,
 * content-hashed id that can't be known ahead of time. Each maps to an intended
 * profile *title* in `SEED_CLEANING_PROFILE_TITLES`, resolved on startup by
 * `linkSeedCleaningProfiles()` — see `link_seed_cleaning_profiles.ts`.
 */
export const SEED_CLEANINGS: Cleaning[] = [
  {
    id: 'seed-clean-daily-rinse',
    name: 'Daily Rinse',
    operation: { kind: 'profile', withChemical: false },
    cadence: { byDays: 1 },
    pinnedToHome: true,
  },
  {
    id: 'seed-clean-weekly-group',
    name: 'Weekly Group Clean',
    operation: { kind: 'profile', withChemical: true },
    cadence: { byDays: 7, byShots: 50 },
    pinnedToHome: true,
  },
  {
    id: 'seed-clean-descale',
    name: 'Descale',
    operation: { kind: 'descale', withChemical: true },
    pinnedToHome: false,
  },
];

/**
 * Intended cleaning profile for each profile-kind seed Cleaning, by gateway
 * profile *title*. Resolved to a real `profileId` on startup by
 * `linkSeedCleaningProfiles()` — only applied when the title matches a profile
 * loaded on the gateway.
 */
export const SEED_CLEANING_PROFILE_TITLES: Record<string, string> = {
  'seed-clean-daily-rinse': 'Cleaning/Forward Flush x5',
  'seed-clean-weekly-group': 'Cleaning/Forward Flush x5',
};
