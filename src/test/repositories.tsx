import type { Component, JSX } from 'solid-js';
import { RepositoriesProvider } from '../RepositoriesContext';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
  LocalPitcherRepository,
  LocalVesselRepository,
  LocalCleaningRepository,
  type RoutineRepository,
  type RecipeRepository,
  type PitcherRepository,
  type VesselRepository,
  type CleaningRepository,
} from '../repositories';
import { MemoryStorage } from './memoryStorage';

/**
 * Test wrapper that provides RepositoriesContext backed by fresh in-memory
 * Local repositories. By default all repos are seeded — pass `routines` /
 * `recipes` / `pitchers` / `vessels` / `cleanings` to override with fakes for tests that
 * want fine-grained control over what's in them.
 */
export const WithRepositories: Component<{
  children: JSX.Element;
  routines?: RoutineRepository;
  recipes?: RecipeRepository;
  pitchers?: PitcherRepository;
  vessels?: VesselRepository;
  cleanings?: CleaningRepository;
}> = (p) => {
  const routines = p.routines ?? new LocalRoutineRepository(new MemoryStorage());
  const recipes = p.recipes ?? new LocalRecipeRepository(new MemoryStorage());
  const pitchers = p.pitchers ?? new LocalPitcherRepository(new MemoryStorage());
  const vessels = p.vessels ?? new LocalVesselRepository(new MemoryStorage());
  const cleanings =
    p.cleanings ?? new LocalCleaningRepository(new MemoryStorage());
  return (
    <RepositoriesProvider
      routines={routines}
      recipes={recipes}
      pitchers={pitchers}
      vessels={vessels}
      cleanings={cleanings}
    >
      {p.children}
    </RepositoriesProvider>
  );
};
