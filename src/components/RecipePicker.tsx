import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  type Accessor,
  type Component,
  type Resource,
} from 'solid-js';
import type { Recipe } from '../domain';
import type { RecipeRepository } from '../repositories';
import { api, type ProfileRecord } from '../api';
import { RecipeTile } from './RecipeTile';

/**
 * Recipe picker grid (was WorkflowPicker). Loads recipes from the injected
 * repository and renders one RecipeTile each. Tapping a tile invokes
 * `onSelect` — the parent decides what happens (route to the runtime
 * wizard, etc.).
 *
 * Repository is injected, not imported, so tests can pass an in-memory
 * fake without touching real storage. See [[starter-skin-storage]].
 *
 * `refresh` is exposed for callers that mutate the library (e.g. after the
 * user creates a Recipe in the editor) and want the picker to re-pull.
 *
 * Tiles are always navigable; gating on "not ready" signals (low water,
 * heater off, warming up) happens at the prep-screen Start button.
 */
export interface RecipePickerProps {
  repository: RecipeRepository;
  onSelect: (recipe: Recipe) => void;
  /** Fetcher seam for the gateway's profile list. The picker resolves
   *  each tile's profile name from this for the subtitle. Defaults to
   *  `api.profiles({})`; tests can inject a fake or omit (the default
   *  catches its own errors so an offline gateway just hides the
   *  subtitle on every tile). */
  loadProfiles?: () => Promise<ProfileRecord[]>;
  /** Library revision — when provided, the recipe list re-runs on a gateway
   *  sync pull (see docs/storage-sync.md). Optional so tests/standalone use
   *  still work (falls back to a one-shot load + the imperative refresh). */
  revision?: Accessor<number>;
}

export interface RecipePickerHandle {
  recipes: Resource<Recipe[]>;
  refresh: () => void;
}

export const RecipePicker: Component<
  RecipePickerProps & { ref?: (h: RecipePickerHandle) => void }
> = (p) => {
  // Constant source when no revision is supplied → fetcher runs once (0 is a
  // valid, non-nullish createResource source); a real revision re-runs it on
  // each pull. The imperative refresh handle still works either way.
  // listVisible() — hidden recipes (e.g. a bean that ran out) are kept out of
  // the home picker but stay in the Library. See docs + RecipeRepository.
  const [recipes, { refetch }] = createResource(
    () => (p.revision ?? (() => 0))(),
    () => p.repository.listVisible(),
  );
  p.ref?.({ recipes, refresh: () => void refetch() });

  // Profile list — fetched once on mount, used to look up each tile's
  // profile title. Catches its own errors so an offline gateway just
  // hides the subtitle on every tile; the recipes themselves still
  // render from the local repository.
  const [profiles] = createResource<ProfileRecord[] | null>(() =>
    (p.loadProfiles ?? (() => api.profiles({})))().catch((e) => {
      console.warn('profile list load failed', e);
      return null;
    }),
  );
  const profileTitleById = createMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    const list = profiles();
    if (!list) return map;
    for (const r of list) {
      const t = (r.profile.title ?? '').trim();
      if (t) map.set(r.id, t);
    }
    return map;
  });
  const profileTitleFor = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    return profileTitleById().get(id);
  };

  return (
    <section class="picker" aria-label="Recipe picker">
      <Switch>
        <Match when={recipes.loading}>
          <p class="muted">loading recipes…</p>
        </Match>
        <Match when={recipes.error}>
          <p class="muted" role="alert">
            failed to load recipes
          </p>
        </Match>
        <Match when={recipes()}>
          <Show
            when={(recipes() ?? []).length > 0}
            fallback={
              <p class="muted">
                no recipes shown — add or unhide one in the library
              </p>
            }
          >
            <div class="picker__grid" data-testid="picker-grid">
              <For each={recipes()}>
                {(r) => (
                  <RecipeTile
                    recipe={r}
                    onSelect={p.onSelect}
                    profileTitle={profileTitleFor(r.profileId)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Match>
      </Switch>
    </section>
  );
};

/** Test helper: convenience accessor for the recipes resource. */
export const useRecipes = (h: RecipePickerHandle): Accessor<Recipe[]> =>
  () => h.recipes() ?? [];
