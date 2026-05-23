import type { Component, JSX } from 'solid-js';
import { RepositoriesProvider } from '../RepositoriesContext';
import {
  LocalBeverageRepository,
  LocalRecipeRepository,
  type BeverageRepository,
  type RecipeRepository,
} from '../repositories';
import { MemoryStorage } from './memoryStorage';

/**
 * Test wrapper that provides RepositoriesContext backed by fresh in-memory
 * Local repositories. By default both repos are seeded — pass `beverages`
 * / `recipes` to override with fakes for tests that want fine-grained
 * control over what's in them.
 */
export const WithRepositories: Component<{
  children: JSX.Element;
  beverages?: BeverageRepository;
  recipes?: RecipeRepository;
}> = (p) => {
  const beverages = p.beverages ?? new LocalBeverageRepository(new MemoryStorage());
  const recipes = p.recipes ?? new LocalRecipeRepository(new MemoryStorage());
  return (
    <RepositoriesProvider beverages={beverages} recipes={recipes}>
      {p.children}
    </RepositoriesProvider>
  );
};
