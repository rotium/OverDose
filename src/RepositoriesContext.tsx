import {
  createContext,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import type {
  RoutineRepository,
  RecipeRepository,
  PitcherRepository,
} from './repositories';

/**
 * Shared access to user-data repositories. Used by screens that need
 * multiple repositories (Library tab, future editors) so we don't have to
 * prop-drill repos through nested sub-nav components.
 *
 * Home stays on prop-injected `recipeRepository` for now — its tests rely
 * on that surface and there's no benefit to migrating it. Use this context
 * for new code that touches Routine + Recipe together.
 */
export interface RepositoriesContextValue {
  routines: RoutineRepository;
  recipes: RecipeRepository;
  pitchers: PitcherRepository;
  /** Library revision — bumps on any local mutation or a gateway sync pull.
   *  List resources take this as a `createResource` source so a pull (or a
   *  cross-screen edit) re-renders them. See docs/storage-sync.md. */
  revision: Accessor<number>;
}

const Ctx = createContext<RepositoriesContextValue>();

export interface RepositoriesProviderProps {
  routines: RoutineRepository;
  recipes: RecipeRepository;
  pitchers: PitcherRepository;
  /** Optional so test harnesses can mount without the sync coordinator; falls
   *  back to a constant (no live pulls in tests). */
  revision?: Accessor<number>;
  children?: JSX.Element;
}

export const RepositoriesProvider: Component<RepositoriesProviderProps> = (p) => {
  // Pin once at mount — repository identity should not change.
  const value: RepositoriesContextValue = {
    routines: p.routines,
    recipes: p.recipes,
    pitchers: p.pitchers,
    revision: p.revision ?? (() => 0),
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
