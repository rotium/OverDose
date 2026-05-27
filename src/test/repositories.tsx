import type { Component, JSX } from 'solid-js';
import { RepositoriesProvider } from '../RepositoriesContext';
import {
  LocalRoutineRepository,
  LocalRecipeRepository,
  type RoutineRepository,
  type RecipeRepository,
} from '../repositories';
import { MemoryStorage } from './memoryStorage';

/**
 * Test wrapper that provides RepositoriesContext backed by fresh in-memory
 * Local repositories. By default both repos are seeded — pass `routines`
 * / `recipes` to override with fakes for tests that want fine-grained
 * control over what's in them.
 */
export const WithRepositories: Component<{
  children: JSX.Element;
  routines?: RoutineRepository;
  recipes?: RecipeRepository;
}> = (p) => {
  const routines = p.routines ?? new LocalRoutineRepository(new MemoryStorage());
  const recipes = p.recipes ?? new LocalRecipeRepository(new MemoryStorage());
  return (
    <RepositoriesProvider routines={routines} recipes={recipes}>
      {p.children}
    </RepositoriesProvider>
  );
};
