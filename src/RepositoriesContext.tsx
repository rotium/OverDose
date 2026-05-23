import {
  createContext,
  useContext,
  type Component,
  type JSX,
} from 'solid-js';
import type {
  BeverageRepository,
  RecipeRepository,
} from './repositories';

/**
 * Shared access to user-data repositories. Used by screens that need
 * multiple repositories (Library tab, future editors) so we don't have to
 * prop-drill repos through nested sub-nav components.
 *
 * Home stays on prop-injected `recipeRepository` for now — its tests rely
 * on that surface and there's no benefit to migrating it. Use this context
 * for new code that touches Beverage + Recipe together.
 */
export interface RepositoriesContextValue {
  beverages: BeverageRepository;
  recipes: RecipeRepository;
}

const Ctx = createContext<RepositoriesContextValue>();

export interface RepositoriesProviderProps {
  beverages: BeverageRepository;
  recipes: RecipeRepository;
  children?: JSX.Element;
}

export const RepositoriesProvider: Component<RepositoriesProviderProps> = (p) => {
  // Pin once at mount — repository identity should not change.
  const value: RepositoriesContextValue = {
    beverages: p.beverages,
    recipes: p.recipes,
  };
  return <Ctx.Provider value={value}>{p.children}</Ctx.Provider>;
};

export function useRepositories(): RepositoriesContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useRepositories must be used inside <RepositoriesProvider>');
  }
  return ctx;
}
