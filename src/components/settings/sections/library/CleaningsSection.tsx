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
import type { Cleaning, CleaningKind, CleaningOperation } from '../../../../domain';
import {
  CLEANING_KINDS,
  cleaningDue,
  cleaningKindLabel,
  newCleanStep,
  operationSummary,
} from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { EyeIcon, EyeOffIcon } from '../../../icons';
import { CleaningKindIcon } from '../../../CleaningKindIcon';
import { CleaningEditor } from './CleaningEditor';

const SHEET_ANIM_MS = 280;

/** Default operation for a freshly-created cleaning of a given kind. */
const defaultOperation = (kind: CleaningKind): CleaningOperation => {
  switch (kind) {
    case 'clean':
      // Start with one coffee-side step so a new Clean isn't empty.
      return { kind: 'clean', steps: [newCleanStep('coffeeSide')] };
    case 'descale':
      return { kind: 'descale', withChemical: true };
  }
};

/**
 * Cleanings list + side-sheet editor. Mirrors RecipesSection: clickable rows
 * open a side-sheet editor; close via X, backdrop, or Escape. `+ New Cleaning`
 * reveals an inline name + operation-kind form. The pin toggle (eye) controls
 * whether the cleaning surfaces on Home.
 */
export const CleaningsSection: Component = () => {
  const repos = useRepositories();
  const [cleanings, { refetch }] = createResource(repos.revision, () =>
    repos.cleanings.list(),
  );

  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [draftName, setDraftName] = createSignal('');
  const [draftKind, setDraftKind] = createSignal<CleaningKind>('clean');
  let nameInputRef: HTMLInputElement | undefined;
  let exitTimer: number | undefined;

  const toggleHidden = async (c: Cleaning) => {
    await repos.cleanings.update({ ...c, hidden: !c.hidden });
    void refetch();
  };

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
      void refetch();
    }, SHEET_ANIM_MS);
  };

  const openCreate = () => {
    setDraftName('');
    setDraftKind('clean');
    setCreating(true);
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
    await repos.cleanings.create({
      id,
      name,
      operation: defaultOperation(draftKind()),
    });
    setCreating(false);
    setDraftName('');
    await refetch();
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
          aria-labelledby="library-cleanings-heading"
        >
          <h2 id="library-cleanings-heading">Cleanings</h2>
          <p class="settings-help">
            Maintain your machine — flushes, group cleans, and descaling. Pinned
            ones show on the home screen.
          </p>

          <Show
            when={creating()}
            fallback={
              <button
                type="button"
                class="btn routines-section__add-btn"
                data-testid="open-new-cleaning"
                onClick={openCreate}
              >
                + New Cleaning
              </button>
            }
          >
            <form
              class="routines-section__add-form"
              data-testid="new-cleaning-form"
              onSubmit={submitCreate}
            >
              <input
                ref={(el) => (nameInputRef = el)}
                type="text"
                class="routines-section__add-input"
                placeholder="Cleaning name"
                aria-label="New cleaning name"
                data-testid="new-cleaning-name"
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
                aria-label="Operation for new cleaning"
                data-testid="new-cleaning-kind"
                class="recipe-editor__routine-select"
                value={draftKind()}
                onChange={(e) =>
                  setDraftKind(e.currentTarget.value as CleaningKind)
                }
              >
                <For each={CLEANING_KINDS}>
                  {(k) => <option value={k}>{cleaningKindLabel(k)}</option>}
                </For>
              </select>
              <button
                type="submit"
                class="btn"
                data-testid="confirm-new-cleaning"
                disabled={draftName().trim().length === 0}
              >
                Create
              </button>
              <button
                type="button"
                class="btn"
                data-testid="cancel-new-cleaning"
                onClick={cancelCreate}
              >
                Cancel
              </button>
            </form>
          </Show>

          <Switch>
            <Match when={cleanings.loading}>
              <p class="muted">loading cleanings…</p>
            </Match>
            <Match when={cleanings.error}>
              <p class="muted" role="alert">
                failed to load cleanings
              </p>
            </Match>
            <Match when={cleanings()}>
              <Show
                when={(cleanings() ?? []).length > 0}
                fallback={<p class="muted">no cleanings yet</p>}
              >
                <ul class="library-list" data-testid="cleanings-list">
                  <For each={cleanings()}>
                    {(c) => {
                      const due = () => cleaningDue(c, { now: Date.now() });
                      return (
                        <li
                          class="library-list__row library-list__row--clickable"
                          data-hidden={c.hidden ? 'true' : undefined}
                          data-testid={`cleaning-row-${c.id}-item`}
                        >
                          <button
                            type="button"
                            class="library-list__button"
                            data-testid={`cleaning-row-${c.id}`}
                            onClick={() => openEditor(c.id)}
                          >
                            <span class="library-list__name">
                              <CleaningKindIcon kind={c.operation.kind} /> {c.name}
                            </span>
                            <span class="library-list__meta recipes-section__meta">
                              <span class="recipes-section__routine">
                                {due().label}
                                <Show when={due().due}>
                                  {' '}
                                  <span
                                    class="cleanings-section__due"
                                    data-testid={`cleaning-row-${c.id}-due`}
                                  >
                                    ● due
                                  </span>
                                </Show>
                              </span>
                              <span class="recipes-section__sequence">
                                {operationSummary(c.operation)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            class="library-list__action"
                            data-testid={`cleaning-row-${c.id}-toggle-hidden`}
                            aria-pressed={c.hidden ? 'true' : 'false'}
                            aria-label={
                              c.hidden
                                ? `Show "${c.name}" on the home screen`
                                : `Hide "${c.name}" from the home screen`
                            }
                            title={c.hidden ? 'Hidden — tap to show' : 'Hide from home'}
                            onClick={() => void toggleHidden(c)}
                          >
                            {c.hidden ? (
                              <EyeOffIcon size={18} />
                            ) : (
                              <EyeIcon size={18} />
                            )}
                          </button>
                        </li>
                      );
                    }}
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
          aria-label="Cleaning editor"
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
            <CleaningEditor cleaningId={selectedId()!} onClose={closeEditor} />
          </div>
        </aside>
      </Show>
    </div>
  );
};
