import type { ProfileRecord } from '../api';
import type { RecipeRepository } from './recipe_repository';
import { SEED_RECIPE_PROFILE_TITLES } from './seed_recipes';

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Link each seed Recipe to its intended espresso profile by *title*.
 *
 * Seed Recipes ship without a `profileId` because a profile is a
 * gateway-owned, content-hashed id that can't be known ahead of time. This
 * resolves the intended titles in `SEED_RECIPE_PROFILE_TITLES` against the
 * gateway's profile list (case-insensitive, trimmed) and writes the matched
 * `profileId` into the Recipe.
 *
 * Idempotent and non-destructive: it only fills a Recipe whose `profileId` is
 * still empty, so a user's own profile pick is never overwritten, and a
 * re-run after everything's linked is a no-op. Recipes that were deleted, or
 * whose title isn't loaded on the gateway, are skipped. Call it once on
 * startup with the fetched profile list. Returns how many it linked.
 */
export const linkSeedRecipeProfiles = async (
  recipes: RecipeRepository,
  profiles: ProfileRecord[],
): Promise<number> => {
  let linked = 0;
  for (const [recipeId, title] of Object.entries(SEED_RECIPE_PROFILE_TITLES)) {
    const recipe = await recipes.get(recipeId);
    if (!recipe || recipe.profileId) continue;
    const match = profiles.find((p) => norm(p.profile.title) === norm(title));
    if (!match) continue;
    await recipes.update({ ...recipe, profileId: match.id });
    linked += 1;
  }
  return linked;
};
