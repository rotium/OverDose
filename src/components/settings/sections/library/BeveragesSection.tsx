import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { formatStepType } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { BeverageEditor } from './BeverageEditor';

const SHEET_ANIM_MS = 280;

/**
 * Beverages list + side-sheet editor.
 *
 * Clicking a row slides a side-sheet in from the right (~70% width) over
 * a dimmed backdrop, with the editor inside. The list stays visible
 * behind the backdrop so the user keeps spatial context. Close affordances:
 * X button on the sheet, click on the backdrop, or Escape key.
 *
 * Reads via `listVisible()` so hidden detach-clones don't show up; the
 * runtime still resolves them via `get(id)` regardless of visibility.
 *
 * Close mirrors the LiveBrewDrawer's pattern: an `animatingOut` flag flips
 * the slide-out animation, then after the CSS transition completes we
 * unmount + refetch the list (so renames/deletes are visible on return).
 */
export const BeveragesSection: Component = () => {
  const repos = useRepositories();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  const [beverages, { refetch }] = createResource(() =>
    repos.beverages.listVisible(),
  );
  const [creating, setCreating] = createSignal(false);
  const [draftName, setDraftName] = createSignal('');
  let nameInputRef: HTMLInputElement | undefined;
  let exitTimer: number | undefined;

  const openEditor = (id: string) => {
    if (exitTimer !== undefined) {
      clearTimeout(exitTimer);
      exitTimer = undefined;
    }
    setAnimatingOut(false);
    setSelectedId(id);
  };

  const openCreate = () => {
    setDraftName('');
    setCreating(true);
    // Defer focus until after the input mounts.
    queueMicrotask(() => nameInputRef?.focus());
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraftName('');
  };

  const submitCreate = async (e?: Event) => {
    e?.preventDefault();
    const name = draftName().trim();
    if (!name) return;
    const id = crypto.randomUUID();
    await repos.beverages.create({ id, name, steps: [] });
    setCreating(false);
    setDraftName('');
    await refetch();
    openEditor(id);
  };

  const closeEditor = () => {
    if (selectedId() === null) return;
    setAnimatingOut(true);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    exitTimer = window.setTimeout(() => {
      setSelectedId(null);
      setAnimatingOut(false);
      exitTimer = undefined;
      void refetch();
    }, SHEET_ANIM_MS);
  };

  // Escape closes the sheet — wired on mount so it works whether or not
  // the sheet is currently open.
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
          aria-labelledby="library-beverages-heading"
        >
          <h2 id="library-beverages-heading">Beverages</h2>
          <p class="settings-help">
            How you brew each drink — a sequence of steps with default
            values that all Recipes for this Beverage inherit.
          </p>

          <Show
            when={creating()}
            fallback={
              <button
                type="button"
                class="btn beverages-section__add-btn"
                data-testid="open-new-beverage"
                onClick={openCreate}
              >
                + New Beverage
              </button>
            }
          >
            <form
              class="beverages-section__add-form"
              data-testid="new-beverage-form"
              onSubmit={submitCreate}
            >
              <input
                ref={(el) => (nameInputRef = el)}
                type="text"
                class="beverages-section__add-input"
                placeholder="Beverage name"
                aria-label="New beverage name"
                data-testid="new-beverage-name"
                value={draftName()}
                onInput={(e) => setDraftName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelCreate();
                  }
                }}
              />
              <button
                type="submit"
                class="btn"
                data-testid="confirm-new-beverage"
                disabled={draftName().trim().length === 0}
              >
                Create
              </button>
              <button
                type="button"
                class="btn"
                data-testid="cancel-new-beverage"
                onClick={cancelCreate}
              >
                Cancel
              </button>
            </form>
          </Show>

          <Switch>
            <Match when={beverages.loading}>
              <p class="muted">loading beverages…</p>
            </Match>
            <Match when={beverages.error}>
              <p class="muted" role="alert">
                failed to load beverages
              </p>
            </Match>
            <Match when={beverages()}>
              <Show
                when={(beverages() ?? []).length > 0}
                fallback={<p class="muted">no beverages yet</p>}
              >
                <ul class="library-list" data-testid="beverages-list">
                  <For each={beverages()}>
                    {(b) => (
                      <li class="library-list__row library-list__row--clickable">
                        <button
                          type="button"
                          class="library-list__button"
                          data-testid={`beverage-row-${b.id}`}
                          onClick={() => openEditor(b.id)}
                        >
                          <span class="library-list__name">{b.name}</span>
                          <span
                            class="library-list__meta beverages-section__sequence"
                            data-testid={`beverage-row-${b.id}-sequence`}
                          >
                            {b.steps.length === 0
                              ? '(no steps yet)'
                              : b.steps.map((s) => formatStepType(s.type)).join(' → ')}
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
          aria-label="Beverage editor"
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
            <BeverageEditor beverageId={selectedId()!} onClose={closeEditor} />
          </div>
        </aside>
      </Show>
    </div>
  );
};
