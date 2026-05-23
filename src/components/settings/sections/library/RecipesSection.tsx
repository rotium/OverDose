import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  type Component,
} from 'solid-js';
import type { Beverage, Recipe } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';

/**
 * Recipes list (read-only for now — editor lands in Phase 4). Each row
 * shows the Recipe name and its parent Beverage name, since users think in
 * pairs ("Wife's [Cappuccino]"). Beverages and recipes are fetched in
 * parallel; rendering waits for both.
 */
export const RecipesSection: Component = () => {
  const repos = useRepositories();
  const [recipes] = createResource<Recipe[]>(() => repos.recipes.list());
  // Read the full list (incl. hidden) so detached Recipes can still show
  // their parent's name.
  const [beverages] = createResource<Beverage[]>(() => repos.beverages.list());

  const beverageNameById = createMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const b of beverages() ?? []) map[b.id] = b.name;
    return map;
  });

  const loading = () => recipes.loading || beverages.loading;
  const errored = () => recipes.error || beverages.error;

  return (
    <div class="settings-section-stack">
      <section
        class="settings-section"
        aria-labelledby="library-recipes-heading"
      >
        <h2 id="library-recipes-heading">Recipes</h2>
        <p class="settings-help">
          A specific way to make a Beverage — bean, dose, grind, milk
          preferences. Inherits everything you don't override from the
          parent Beverage.
        </p>

        <Switch>
          <Match when={loading()}>
            <p class="muted">loading recipes…</p>
          </Match>
          <Match when={errored()}>
            <p class="muted" role="alert">
              failed to load recipes
            </p>
          </Match>
          <Match when={recipes() && beverages()}>
            <Show
              when={(recipes() ?? []).length > 0}
              fallback={<p class="muted">no recipes yet</p>}
            >
              <ul class="library-list" data-testid="recipes-list">
                <For each={recipes()}>
                  {(r) => (
                    <li
                      class="library-list__row"
                      data-testid={`recipe-row-${r.id}`}
                    >
                      <span class="library-list__name">{r.name}</span>
                      <span class="library-list__meta">
                        {beverageNameById()[r.beverageId] ?? '(missing beverage)'}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Match>
        </Switch>
      </section>
    </div>
  );
};
