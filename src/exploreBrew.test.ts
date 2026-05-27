import { describe, expect, it } from 'vitest';
import { buildExploreBrewBundle, EXPLORE_BREW_RECIPE_ID } from './exploreBrew';
import type { ProfileRecord, WorkflowSnapshot } from './api';

const mkProfile = (id: string, title: string): ProfileRecord =>
  ({ id, profile: { title } }) as unknown as ProfileRecord;

const profiles = [
  mkProfile('p-gentle', 'Gentle and sweet'),
  mkProfile('p-flow', 'Flow profile for milky drinks'),
];

describe('buildExploreBrewBundle', () => {
  it('builds a single-brew-step routine + ad-hoc recipe', () => {
    const { recipe, routine } = buildExploreBrewBundle(null, []);
    expect(recipe?.id).toBe(EXPLORE_BREW_RECIPE_ID);
    expect(recipe?.routineId).toBe(routine?.id);
    expect(routine?.steps).toHaveLength(1);
    expect(routine?.steps[0].type).toBe('brew');
  });

  it('seeds dose + yield from the current workflow context', () => {
    const wf: WorkflowSnapshot = {
      profile: { title: 'Gentle and sweet' },
      context: { targetDoseWeight: 18, targetYield: 36 },
    };
    const { recipe } = buildExploreBrewBundle(wf, profiles);
    expect(recipe?.doseGrams).toBe(18);
    expect(recipe?.targetYieldGrams).toBe(36);
  });

  it("resolves the workflow profile's title to a profileId", () => {
    const wf: WorkflowSnapshot = { profile: { title: 'Gentle and sweet' } };
    expect(buildExploreBrewBundle(wf, profiles).recipe?.profileId).toBe('p-gentle');
  });

  it('leaves profileId unset when the title is not in the gateway list', () => {
    const wf: WorkflowSnapshot = { profile: { title: 'Unknown Profile' } };
    expect(buildExploreBrewBundle(wf, profiles).recipe?.profileId).toBeUndefined();
  });

  it('treats a zero/absent targetYield as no target', () => {
    const wf: WorkflowSnapshot = { context: { targetYield: 0 } };
    expect(buildExploreBrewBundle(wf, profiles).recipe?.targetYieldGrams).toBeUndefined();
  });

  it('handles a null workflow (no profiles loaded yet)', () => {
    const { recipe } = buildExploreBrewBundle(null, []);
    expect(recipe?.doseGrams).toBeUndefined();
    expect(recipe?.profileId).toBeUndefined();
  });
});
