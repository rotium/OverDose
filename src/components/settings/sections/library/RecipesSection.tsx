import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { formatStepType } from '../../../../domain';
import type { Beverage, Recipe } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { RecipeEditor } from './RecipeEditor';

const SHEET_ANIM_MS = 280;

/**
 * Recipes list + side-sheet editor (Phase 4a).
 *
 * Mirrors BeveragesSection's structure: clickable rows open a side-sheet
 * with the editor; close affordances via X, backdrop, or Escape. The list
 * also exposes a `+ New Recipe` button that reveals an inline name +
 * Beverage-picker form (a Recipe can't exist without a parent Beverage,
 * so the picker is required at create time). If there are no Beverages,
 * the Create button is disabled and the form explains why.
 *
 * Beverages are loaded with `list()` (not `listVisible()`) so a Recipe
 * whose parent was detached into a hidden clone still resolves its parent
 * name in the row meta. The picker for new Recipes uses `listVisible()`
 * since users shouldn't be able to manually pick a hidden clone.
 */
export const RecipesSection: Component = () => {
  const repos = useRepositories();
  const [recipes, { refetch: refetchRecipes }] = createResource<Recipe[]>(() =>
    repos.recipes.list(),
  );
  const [beverages] = createResource<Beverage[]>(() => repos.beverages.list());
  const [visibleBeverages] = createResource<Beverage[]>(() =>
    repos.beverages.listVisible(),
  );

  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [draftName, setDraftName] = createSignal('');
  const [draftBeverageId, setDraftBeverageId] = createSignal('');
  let nameInputRef: HTMLInputElement | undefined;
  let exitTimer: number | undefined;

  const beverageById = createMemo<Record<string, Beverage>>(() => {
    const map: Record<string, Beverage> = {};
    for (const b of beverages() ?? []) map[b.id] = b;
    return map;
  });

  const stepSequence = (beverageId: string): string => {
    const steps = beverageById()[beverageId]?.steps ?? [];
    if (steps.length === 0) return '(no steps yet)';
    return steps.map((s) => formatStepType(s.type)).join(' → ');
  };

  const loading = () =>
    recipes.loading || beverages.loading || visibleBeverages.loading;
  const errored = () =>
    recipes.error || beverages.error || visibleBeverages.error;

  const openEditor = (id: string) => {
    if (exitTimer !== undefined) {
      clearTimeout(exitTimer);
      exitTimer = undefined;
    }
    setAnimatingOut(false);
    setSelectedId(id);
  };

  const closeEditor = () => {
    if (selectedId() === null) return;
    setAnimatingOut(true);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    exitTimer = window.setTimeout(() => {
      setSelectedId(null);
      setAnimatingOut(false);
      exitTimer = undefined;
      void refetchRecipes();
    }, SHEET_ANIM_MS);
  };

  const openCreate = () => {
    setDraftName('');
    setDraftBeverageId((visibleBeverages() ?? [])[0]?.id ?? '');
    setCreating(true);
    queueMicrotask(() => nameInputRef?.focus());
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraftName('');
    setDraftBeverageId('');
  };

  const submitCreate = async (e?: Event) => {
    e?.preventDefault();
    const name = draftName().trim();
    const beverageId = draftBeverageId();
    if (!name || !beverageId) return;
    const id = crypto.randomUUID();
    await repos.recipes.create({ id, name, beverageId, overrides: {} });
    setCreating(false);
    setDraftName('');
    setDraftBeverageId('');
    await refetchRecipes();
    openEditor(id);
  };

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId() !== null) closeEditor();
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  onCleanup(() => {
    if (exitTimer !== undefined) clearTimeout(exitTimer);
  });

  return (
    <div class="beverages-section">
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

          <Show
            when={creating()}
            fallback={
              <button
                type="button"
                class="btn beverages-section__add-btn"
                data-testid="open-new-recipe"
                disabled={(visibleBeverages() ?? []).length === 0}
                title={
                  (visibleBeverages() ?? []).length === 0
                    ? 'Create a Beverage first'
                    : undefined
                }
                onClick={openCreate}
              >
                + New Recipe
              </button>
            }
          >
            <form
              class="beverages-section__add-form"
              data-testid="new-recipe-form"
              onSubmit={submitCreate}
            >
              <input
                ref={(el) => (nameInputRef = el)}
                type="text"
                class="beverages-section__add-input"
                placeholder="Recipe name"
                aria-label="New recipe name"
                data-testid="new-recipe-name"
                value={draftName()}
                onInput={(e) => setDraftName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelCreate();
                  }
                }}
              />
              <select
                aria-label="Beverage for new recipe"
                data-testid="new-recipe-beverage"
                class="recipe-editor__beverage-select"
                value={draftBeverageId()}
                onChange={(e) => setDraftBeverageId(e.currentTarget.value)}
              >
                <For each={visibleBeverages() ?? []}>
                  {(b) => <option value={b.id}>{b.name}</option>}
                </For>
              </select>
              <button
                type="submit"
                class="btn"
                data-testid="confirm-new-recipe"
                disabled={
                  draftName().trim().length === 0 || draftBeverageId() === ''
                }
              >
                Create
              </button>
              <button
                type="button"
                class="btn"
                data-testid="cancel-new-recipe"
                onClick={cancelCreate}
              >
                Cancel
              </button>
            </form>
          </Show>

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
                      <li class="library-list__row library-list__row--clickable">
                        <button
                          type="button"
                          class="library-list__button"
                          data-testid={`recipe-row-${r.id}`}
                          onClick={() => openEditor(r.id)}
                        >
                          <span class="library-list__name">{r.name}</span>
                          <span class="library-list__meta recipes-section__meta">
                            <span class="recipes-section__beverage">
                              {beverageById()[r.beverageId]?.name ??
                                '(missing beverage)'}
                            </span>
                            <span
                              class="recipes-section__sequence"
                              data-testid={`recipe-row-${r.id}-sequence`}
                            >
                              {stepSequence(r.beverageId)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Match>
          </Switch>
        </section>
      </div>

      <Show when={selectedId() !== null}>
        <div
          class="side-sheet__backdrop"
          data-state={animatingOut() ? 'closing' : 'open'}
          data-testid="side-sheet-backdrop"
          aria-hidden="true"
          onClick={closeEditor}
        />
        <aside
          class="side-sheet"
          data-state={animatingOut() ? 'closing' : 'open'}
          data-testid="side-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Recipe editor"
        >
          <button
            type="button"
            class="side-sheet__close"
            aria-label="Close editor"
            data-testid="side-sheet-close"
            onClick={closeEditor}
          >
            ×
          </button>
          <div class="side-sheet__body">
            <RecipeEditor recipeId={selectedId()!} onClose={closeEditor} />
          </div>
        </aside>
      </Show>
    </div>
  );
};
