import type { Recipe } from '../domain';

/**
 * Seed Recipes shipped on first run so the Home picker isn't empty. These are
 * the **named drinks** — each references one of the generic seed Routines (see
 * `seed_routines.ts`) and carries a starting dose + yield. The drink name and
 * its dial-in live here, not on the Routine; the user re-tunes per batch over
 * time (and renames into variants like "Wife's Cappuccino").
 *
 * `profileId` is left unset in the seed itself: a profile is a gateway-owned,
 * content-hashed id specific to the machine's library, so it can't be baked
 * into a seed. Instead each seed Recipe has an intended profile *title*
 * (`SEED_RECIPE_PROFILE_TITLES`); `linkSeedRecipeProfiles()` resolves those
 * titles against the gateway's profile list on startup and writes the real
 * `profileId` in — see `link_seed_profiles.ts`. It only fills a still-empty
 * `profileId`, so a user's own pick always wins.
 */
export const SEED_RECIPES: Recipe[] = [
  {
    id: 'seed-rec-espresso',
    name: 'Espresso',
    routineId: 'seed-routine-brew',
    doseGrams: 18,
    targetYieldGrams: 36,
    overrides: {},
  },
  {
    id: 'seed-rec-cappuccino',
    name: 'Cappuccino',
    routineId: 'seed-routine-brew-steam',
    doseGrams: 18,
    targetYieldGrams: 36,
    overrides: {},
  },
  {
    id: 'seed-rec-americano',
    name: 'Americano',
    routineId: 'seed-routine-brew-water',
    doseGrams: 18,
    targetYieldGrams: 36,
    overrides: {},
  },
  {
    id: 'seed-rec-ristretto',
    name: 'Ristretto',
    routineId: 'seed-routine-brew',
    doseGrams: 18,
    targetYieldGrams: 18,
    overrides: {},
  },
];

/**
 * Intended espresso profile for each seed Recipe, by gateway profile *title*.
 * Resolved to a real `profileId` on startup by `linkSeedRecipeProfiles()` —
 * only applied when the title matches a profile loaded on the gateway.
 */
export const SEED_RECIPE_PROFILE_TITLES: Record<string, string> = {
  'seed-rec-espresso': 'Gentle and sweet',
  'seed-rec-cappuccino': 'Flow profile for milky drinks',
  'seed-rec-americano': 'Espresso Forge Dark',
  'seed-rec-ristretto': "80's Espresso",
};
