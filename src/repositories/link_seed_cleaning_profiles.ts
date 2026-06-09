import type { ProfileRecord } from '../api';
import type { CleaningRepository } from './cleaning_repository';
import { SEED_CLEANING_PROFILE_TITLES } from './seed_cleanings';

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Link each profile-kind seed Cleaning to its intended cleaning profile by
 * *title* — the cleaning analogue of `linkSeedRecipeProfiles`.
 *
 * Seed Cleanings ship without a `profileId` because a profile is a
 * gateway-owned, content-hashed id that can't be known ahead of time. This
 * resolves the intended titles in `SEED_CLEANING_PROFILE_TITLES` against the
 * gateway's profile list (case-insensitive, trimmed) and writes the matched id
 * into the cleaning's `operation.profileId`.
 *
 * Idempotent and non-destructive: only fills a cleaning whose `profileId` is
 * still empty, so a user's own pick is never overwritten and a re-run is a
 * no-op. Cleanings that were deleted, changed kind, or whose title isn't on the
 * gateway are skipped. Returns how many it linked.
 */
export const linkSeedCleaningProfiles = async (
  cleanings: CleaningRepository,
  profiles: ProfileRecord[],
): Promise<number> => {
  let linked = 0;
  for (const [cleaningId, title] of Object.entries(
    SEED_CLEANING_PROFILE_TITLES,
  )) {
    const cleaning = await cleanings.get(cleaningId);
    if (!cleaning || cleaning.operation.kind !== 'profile') continue;
    if (cleaning.operation.profileId) continue;
    const match = profiles.find((p) => norm(p.profile.title) === norm(title));
    if (!match) continue;
    await cleanings.update({
      ...cleaning,
      operation: { ...cleaning.operation, profileId: match.id },
    });
    linked += 1;
  }
  return linked;
};
