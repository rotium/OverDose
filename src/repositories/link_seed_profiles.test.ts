import { describe, expect, it } from 'vitest';
import { LocalRecipeRepository } from './local_recipe_repository';
import { linkSeedRecipeProfiles } from './link_seed_profiles';
import { MemoryStorage } from '../test/memoryStorage';
import type { ProfileRecord } from '../api';

const mkProfile = (id: string, title: string): ProfileRecord =>
  ({
    id,
    profile: { title },
    metadataHash: '',
    compoundHash: '',
    visibility: 'public',
    isDefault: false,
    createdAt: '',
    updatedAt: '',
  }) as unknown as ProfileRecord;

const gatewayProfiles: ProfileRecord[] = [
  mkProfile('p-gentle', 'Gentle and sweet'),
  mkProfile('p-flow', 'Flow profile for milky drinks'),
  mkProfile('p-forge', 'Espresso Forge Dark'),
  mkProfile('p-80s', "80's Espresso"),
  mkProfile('p-other', 'Something else'),
];

const freshRepo = () => new LocalRecipeRepository(new MemoryStorage());

describe('linkSeedRecipeProfiles', () => {
  it('links each seed Recipe to the profile matching its intended title', async () => {
    const repo = freshRepo();
    const linked = await linkSeedRecipeProfiles(repo, gatewayProfiles);
    expect(linked).toBe(4);
    expect((await repo.get('seed-rec-espresso'))?.profileId).toBe('p-gentle');
    expect((await repo.get('seed-rec-cappuccino'))?.profileId).toBe('p-flow');
    expect((await repo.get('seed-rec-americano'))?.profileId).toBe('p-forge');
    expect((await repo.get('seed-rec-ristretto'))?.profileId).toBe('p-80s');
  });

  it('matches title case-insensitively and trimmed', async () => {
    const repo = freshRepo();
    await linkSeedRecipeProfiles(repo, [mkProfile('p-x', '  gentle AND sweet ')]);
    expect((await repo.get('seed-rec-espresso'))?.profileId).toBe('p-x');
  });

  it('never overwrites a profileId the user already set', async () => {
    const repo = freshRepo();
    const espresso = await repo.get('seed-rec-espresso');
    await repo.update({ ...espresso!, profileId: 'user-pick' });
    const linked = await linkSeedRecipeProfiles(repo, gatewayProfiles);
    expect((await repo.get('seed-rec-espresso'))?.profileId).toBe('user-pick');
    // The other three still link.
    expect(linked).toBe(3);
  });

  it('skips a seed Recipe whose intended title is not on the gateway', async () => {
    const repo = freshRepo();
    const linked = await linkSeedRecipeProfiles(repo, [
      mkProfile('p-flow', 'Flow profile for milky drinks'),
    ]);
    expect(linked).toBe(1);
    expect((await repo.get('seed-rec-espresso'))?.profileId).toBeUndefined();
    expect((await repo.get('seed-rec-cappuccino'))?.profileId).toBe('p-flow');
  });

  it('is idempotent — a second run links nothing new', async () => {
    const repo = freshRepo();
    await linkSeedRecipeProfiles(repo, gatewayProfiles);
    expect(await linkSeedRecipeProfiles(repo, gatewayProfiles)).toBe(0);
  });
});
