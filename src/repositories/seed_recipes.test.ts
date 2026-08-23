import { describe, expect, it } from 'vitest';
import { SEED_RECIPES } from './seed_recipes';
import { SEED_ROUTINES } from './seed_routines';
import { SEED_VESSELS } from './seed_vessels';
import type { WaterConfig } from '../domain';

const recipe = (id: string) => SEED_RECIPES.find((r) => r.id === id)!;
const routine = (id: string) => SEED_ROUTINES.find((b) => b.id === id)!;
const waterCfg = (recipeId: string, stepId: string): WaterConfig =>
  recipe(recipeId).overrides[stepId] as WaterConfig;

describe('seed recipes with hot water', () => {
  // These are the first seeds to carry per-step config, so the ids have to
  // line up across three files. A typo would silently produce a recipe whose
  // water step reads as unconfigured.
  it('keys every water override against a real step of its own routine', () => {
    for (const r of SEED_RECIPES) {
      const steps = routine(r.routineId).steps;
      for (const stepId of Object.keys(r.overrides)) {
        expect(
          steps.some((s) => s.id === stepId),
          `${r.name}: override "${stepId}" matches no step in ${r.routineId}`,
        ).toBe(true);
      }
    }
  });

  it('references only vessels that ship in the seed library', () => {
    for (const r of SEED_RECIPES) {
      for (const cfg of Object.values(r.overrides)) {
        const id = (cfg as WaterConfig).vesselId;
        if (!id) continue;
        expect(SEED_VESSELS.some((v) => v.id === id), `${r.name}: ${id}`).toBe(
          true,
        );
      }
    }
  });

  it('never asks for more than the chosen vessel holds', () => {
    for (const r of SEED_RECIPES) {
      for (const cfg of Object.values(r.overrides)) {
        const { vesselId, volumeMl } = cfg as WaterConfig;
        if (!vesselId || volumeMl === undefined) continue;
        const v = SEED_VESSELS.find((x) => x.id === vesselId)!;
        expect(volumeMl, `${r.name}`).toBeLessThanOrEqual(v.capacityMl);
      }
    }
  });

  it('pours 100 mL at 80 °C into the Cup for an Americano', () => {
    expect(waterCfg('seed-rec-americano', 'seed-routine-brew-water-2')).toEqual({
      vesselId: 'seed-vessel-cup',
      volumeMl: 100,
      tempC: 80,
    });
  });

  it('gives Tea a water-only routine and no espresso fields', () => {
    const tea = recipe('seed-rec-tea');
    expect(routine(tea.routineId).steps.map((s) => s.type)).toEqual(['water']);
    expect(tea.doseGrams).toBeUndefined();
    expect(tea.targetYieldGrams).toBeUndefined();
    expect(waterCfg('seed-rec-tea', 'seed-routine-water-1')).toEqual({
      vesselId: 'seed-vessel-mug',
      volumeMl: 300,
      tempC: 95,
    });
  });
});
