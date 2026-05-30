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
import type { Routine, Recipe } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { EyeIcon, EyeOffIcon } from '../../../icons';
import { RecipeEditor } from './RecipeEditor';

const SHEET_ANIM_MS = 280;

/**
 * Recipes list + side-sheet editor (Phase 4a).
 *
 * Mirrors RoutinesSection's structure: clickable rows open a side-sheet
 * with the editor; close affordances via X, backdrop, or Escape. The list
 * also exposes a `+ New Recipe` button that reveals an inline name +
 * Routine-picker form (a Recipe can't exist without a parent Routine,
 * so the picker is required at create time). If there are no Routines,
 * the Create button is disabled and the form explains why.
 *
 * Routines are loaded with `list()` (not `listVisible()`) so a Recipe
 * whose parent was detached into a hidden clone still resolves its parent
 * name in the row meta. The picker for new Recipes uses `listVisible()`
 * since users shouldn't be able to manually pick a hidden clone.
 */
export const RecipesSection: Component = () => {
  const repos = useRepositories();
  // Sourced on `repos.revision` so a gateway sync pull (or a cross-screen
  // edit) re-runs the list — see docs/storage-sync.md.
  const [recipes, { refetch: refetchRecipes }] = createResource(
    repos.revision,
    () => repos.recipes.list(),
  );
  const [routines] = createResource(repos.revision, () =>
    repos.routines.list(),
  );
  const [visibleRoutines] = createResource(repos.revision, () =>
    repos.routines.listVisible(),
  );

  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [draftName, setDraftName] = createSignal('');
  const [draftRoutineId, setDraftRoutineId] = createSignal('');
  let nameInputRef: HTMLInputElement | undefined;
  let exitTimer: number | undefined;

  const routineById = createMemo<Record<string, Routine>>(() => {
    const map: Record<string, Routine> = {};
    for (const b of routines() ?? []) map[b.id] = b;
    return map;
  });

  const stepSequence = (routineId: string): string => {
    const steps = routineById()[routineId]?.steps ?? [];
    if (steps.length === 0) return '(no steps yet)';
    return steps.map((s) => formatStepType(s.type)).join(' → ');
  };

  // Quick hide/show toggle — keeps a recipe off the Home picker without
  // deleting it (e.g. its bean ran out). The same toggle lives in the editor.
  const toggleHidden = async (r: Recipe) => {
    await repos.recipes.update({ ...r, hidden: !r.hidden });
    void refetchRecipes();
  };

  const loading = () =>
    recipes.loading || routines.loading || visibleRoutines.loading;
  const errored = () =>
    recipes.error || routines.error || visibleRoutines.error;

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
    setDraftRoutineId((visibleRoutines() ?? [])[0]?.id ?? '');
    setCreating(true);
    queueMicrotask(() => nameInputRef?.focus());
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraftName('');
    setDraftRoutineId('');
  };

  const submitCreate = async (e?: Event) => {
    e?.preventDefault();
    const name = draftName().trim();
    const routineId = draftRoutineId();
    if (!name || !routineId) return;
    const id = crypto.randomUUID();
    await repos.recipes.create({ id, name, routineId, overrides: {} });
    setCreating(false);
    setDraftName('');
    setDraftRoutineId('');
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
    <div class="routines-section">
      <div class="settings-section-stack">
        <section
          class="settings-section"
          aria-labelledby="library-recipes-heading"
        >
          <h2 id="library-recipes-heading">Recipes</h2>
          <p class="settings-help">
            A specific way to make a Routine — bean, dose, grind, milk
            preferences. Inherits everything you don't override from the
            parent Routine.
          </p>

          <Show
            when={creating()}
            fallback={
              <button
                type="button"
                class="btn routines-section__add-btn"
                data-testid="open-new-recipe"
                disabled={(visibleRoutines() ?? []).length === 0}
                title={
                  (visibleRoutines() ?? []).length === 0
                    ? 'Create a Routine first'
                    : undefined
                }
                onClick={openCreate}
              >
                + New Recipe
              </button>
            }
          >
            <form
              class="routines-section__add-form"
              data-testid="new-recipe-form"
              onSubmit={submitCreate}
            >
              <input
                ref={(el) => (nameInputRef = el)}
                type="text"
                class="routines-section__add-input"
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
                aria-label="Routine for new recipe"
                data-testid="new-recipe-routine"
                class="recipe-editor__routine-select"
                value={draftRoutineId()}
                onChange={(e) => setDraftRoutineId(e.currentTarget.value)}
              >
                <For each={visibleRoutines() ?? []}>
                  {(b) => <option value={b.id}>{b.name}</option>}
                </For>
              </select>
              <button
                type="submit"
                class="btn"
                data-testid="confirm-new-recipe"
                disabled={
                  draftName().trim().length === 0 || draftRoutineId() === ''
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
            <Match when={recipes() && routines()}>
              <Show
                when={(recipes() ?? []).length > 0}
                fallback={<p class="muted">no recipes yet</p>}
              >
                <ul class="library-list" data-testid="recipes-list">
                  <For each={recipes()}>
                    {(r) => (
                      <li
                        class="library-list__row library-list__row--clickable"
                        data-hidden={r.hidden ? 'true' : undefined}
                        data-testid={`recipe-row-${r.id}-item`}
                      >
                        <button
                          type="button"
                          class="library-list__button"
                          data-testid={`recipe-row-${r.id}`}
                          onClick={() => openEditor(r.id)}
                        >
                          <span class="library-list__name">{r.name}</span>
                          <span class="library-list__meta recipes-section__meta">
                            <span class="recipes-section__routine">
                              {routineById()[r.routineId]?.name ??
                                '(missing routine)'}
                            </span>
                            <span
                              class="recipes-section__sequence"
                              data-testid={`recipe-row-${r.id}-sequence`}
                            >
                              {stepSequence(r.routineId)}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          class="library-list__action"
                          data-testid={`recipe-row-${r.id}-toggle-hidden`}
                          aria-pressed={r.hidden ? 'true' : 'false'}
                          aria-label={
                            r.hidden
                              ? `Show "${r.name}" on the home screen`
                              : `Hide "${r.name}" from the home screen`
                          }
                          title={r.hidden ? 'Hidden — tap to show' : 'Hide from home'}
                          onClick={() => void toggleHidden(r)}
                        >
                          {r.hidden ? (
                            <EyeOffIcon size={18} />
                          ) : (
                            <EyeIcon size={18} />
                          )}
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
