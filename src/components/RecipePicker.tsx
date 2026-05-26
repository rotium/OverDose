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
import { RecipeTile, type DisabledReason } from './RecipeTile';

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
 * `disabledReason` (accessor, optional) gates the whole grid — when it
 * returns a non-null value all tiles render disabled with the matching
 * reason icon (e.g. low-water blocking). Driven by the parent so the rule
 * (which signal, which threshold) lives there, not here.
 */
export interface RecipePickerProps {
  repository: RecipeRepository;
  onSelect: (recipe: Recipe) => void;
  disabledReason?: Accessor<DisabledReason | null>;
  /** Fetcher seam for the gateway's profile list. The picker resolves
   *  each tile's profile name from this for the subtitle. Defaults to
   *  `api.profiles({})`; tests can inject a fake or omit (the default
   *  catches its own errors so an offline gateway just hides the
   *  subtitle on every tile). */
  loadProfiles?: () => Promise<ProfileRecord[]>;
}

export interface RecipePickerHandle {
  recipes: Resource<Recipe[]>;
  refresh: () => void;
}

export const RecipePicker: Component<
  RecipePickerProps & { ref?: (h: RecipePickerHandle) => void }
> = (p) => {
  const [recipes, { refetch }] = createResource(() => p.repository.list());
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
              <p class="muted">no recipes yet — add one from the library</p>
            }
          >
            <div class="picker__grid" data-testid="picker-grid">
              <For each={recipes()}>
                {(r) => {
                  const reason = () => p.disabledReason?.() ?? null;
                  return (
                    <RecipeTile
                      recipe={r}
                      onSelect={p.onSelect}
                      disabled={reason() !== null}
                      disabledReason={reason() ?? undefined}
                      profileTitle={profileTitleFor(r.profileId)}
                    />
                  );
                }}
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
