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
import {
  api,
  type Bean,
  type BeanCreate,
  type BeanPatch,
} from '../../../../api';
import { beanRating, groupBeansByRoaster } from '../../../../beans';
import { ShotRatingFace } from '../../../ShotRatingFace';
import { AutocompleteInput } from './AutocompleteInput';
import { BeanEditor, type BeanEditorProps } from './BeanEditor';
import { log } from '../../../../debugLog';

const SHEET_ANIM_MS = 280;

export interface BeansSectionProps {
  /** Test seams — default to the gateway. Beans are gateway-owned (like
   *  profiles), so there's no local repository to inject. */
  loadBeans?: (opts: { includeArchived: boolean }) => Promise<Bean[]>;
  createBean?: (input: BeanCreate) => Promise<Bean>;
  loadBean?: (id: string) => Promise<Bean | null>;
  saveBean?: (id: string, patch: BeanPatch) => Promise<void>;
  deleteBean?: (id: string) => Promise<void>;
  /** Forwarded to BeanEditor for the derived "Recent shots" rating. */
  loadShots?: BeanEditorProps['loadShots'];
  debounceMs?: number;
}

/**
 * Beans library — coffee beans the gateway owns (BeanStorageService). Unlike
 * the local Routine/Recipe/Pitcher libraries, these read/write the gateway
 * REST API directly (mirroring how Profiles work), so the list has real
 * loading/disconnected states. Beans are grouped into a tree by roaster and
 * sorted alphabetically — an editor surface optimised for "find this entry"
 * (the recipe picker will sort by recency instead). v1 is Bean-level;
 * per-bag batches come next.
 */
export const BeansSection: Component<BeansSectionProps> = (props) => {
  const [showArchived, setShowArchived] = createSignal(false);
  // Source is an object (always truthy) so a `false` includeArchived doesn't
  // read as createResource's "not ready" sentinel and suppress the fetch.
  // Errors resolve to null (like ProfilePicker) — null distinguishes a load
  // failure from an empty list ([]).
  const [beans, { refetch }] = createResource(
    () => ({ includeArchived: showArchived() }),
    (src) =>
      (props.loadBeans ?? ((o) => api.beans(o)))(src).catch((e) => {
        log.warn('bean', 'bean load failed', e);
        return null;
      }),
  );

  const grouped = createMemo(() => groupBeansByRoaster(beans() ?? []));

  // Distinct values the user has already entered, per field — feeds every
  // text field's autocomplete (the editor merges these with any built-in
  // defaults). Empties (cleared fields, saved as "") are filtered out, sorted.
  const distinctField = (pick: (b: Bean) => string | null | undefined) =>
    [
      ...new Set(
        (beans() ?? [])
          .map(pick)
          .filter((v): v is string => !!v && v.trim() !== ''),
      ),
    ].sort((a, b) => a.localeCompare(b));
  // Variety is an array per bean, so flatten across all beans for its list.
  const distinctVariety = () =>
    [
      ...new Set(
        (beans() ?? [])
          .flatMap((b) => b.variety ?? [])
          .filter((v) => v.trim() !== ''),
      ),
    ].sort((a, b) => a.localeCompare(b));
  const existing = createMemo(() => ({
    roaster: distinctField((b) => b.roaster),
    country: distinctField((b) => b.country),
    region: distinctField((b) => b.region),
    producer: distinctField((b) => b.producer),
    species: distinctField((b) => b.species),
    processing: distinctField((b) => b.processing),
    decafProcess: distinctField((b) => b.decafProcess),
    variety: distinctVariety(),
  }));

  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [draftRoaster, setDraftRoaster] = createSignal('');
  const [draftName, setDraftName] = createSignal('');
  let roasterInputRef: HTMLInputElement | undefined;
  let exitTimer: number | undefined;

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
    setDraftRoaster('');
    setDraftName('');
    setCreating(true);
    queueMicrotask(() => roasterInputRef?.focus());
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraftRoaster('');
    setDraftName('');
  };

  const submitCreate = async (e?: Event) => {
    e?.preventDefault();
    const roaster = draftRoaster().trim();
    const name = draftName().trim();
    if (!roaster || !name) return;
    const created = await (props.createBean ?? ((i) => api.createBean(i)))({
      roaster,
      name,
    });
    setCreating(false);
    setDraftRoaster('');
    setDraftName('');
    await refetch();
    openEditor(created.id);
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
        <section class="settings-section" aria-labelledby="library-beans-heading">
          <h2 id="library-beans-heading">Beans</h2>
          <p class="settings-help">
            Your coffee beans, stored on the machine and shared across apps. A
            recipe picks a bean; each shot records what you pulled.
          </p>

          <div class="beans-section__toolbar">
            <Show
              when={creating()}
              fallback={
                <button
                  type="button"
                  class="btn routines-section__add-btn"
                  data-testid="open-new-bean"
                  onClick={openCreate}
                >
                  + New bean
                </button>
              }
            >
              <form
                class="routines-section__add-form"
                data-testid="new-bean-form"
                onSubmit={submitCreate}
              >
                <AutocompleteInput
                  inputRef={(el) => (roasterInputRef = el)}
                  value={draftRoaster()}
                  suggestions={existing().roaster}
                  onInput={setDraftRoaster}
                  onEscape={cancelCreate}
                  placeholder="Roaster"
                  ariaLabel="New bean roaster"
                  testId="new-bean-roaster"
                  class="routines-section__add-input"
                  wrapperClass="beans-section__roaster-field"
                />
                <input
                  type="text"
                  class="routines-section__add-input"
                  placeholder="Name"
                  aria-label="New bean name"
                  data-testid="new-bean-name"
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
                  data-testid="confirm-new-bean"
                  disabled={
                    draftRoaster().trim().length === 0 ||
                    draftName().trim().length === 0
                  }
                >
                  Add
                </button>
                <button
                  type="button"
                  class="btn"
                  data-testid="cancel-new-bean"
                  onClick={cancelCreate}
                >
                  Cancel
                </button>
              </form>
            </Show>

            <label class="beans-section__archived-toggle">
              <input
                type="checkbox"
                checked={showArchived()}
                data-testid="beans-show-archived"
                onChange={(e) => setShowArchived(e.currentTarget.checked)}
              />
              Show archived
            </label>
          </div>

          <Switch>
            <Match when={beans.loading}>
              <p class="muted">loading beans…</p>
            </Match>
            <Match when={beans() === null}>
              <p class="muted" role="alert" data-testid="beans-load-error">
                Couldn't load beans — check the gateway connection.
              </p>
            </Match>
            <Match when={beans()}>
              <Show
                when={grouped().length > 0}
                fallback={
                  <p class="muted">No beans yet — add your first bag.</p>
                }
              >
                <ul class="bean-tree" data-testid="beans-tree">
                  <For each={grouped()}>
                    {(group) => (
                      <li class="bean-tree__group">
                        <details open>
                          <summary class="bean-tree__roaster">
                            {group.roaster}
                          </summary>
                          <ul class="bean-tree__beans">
                            <For each={group.beans}>
                              {(b) => (
                                <li class="library-list__row library-list__row--clickable">
                                  <button
                                    type="button"
                                    class="library-list__button"
                                    data-testid={`bean-row-${b.id}`}
                                    onClick={() => openEditor(b.id)}
                                  >
                                    <span class="library-list__name">
                                      {b.name}
                                      <Show when={b.decaf}>
                                        <span class="bean-tree__badge">
                                          decaf
                                        </span>
                                      </Show>
                                      <Show when={b.archived}>
                                        <span class="bean-tree__badge bean-tree__badge--muted">
                                          archived
                                        </span>
                                      </Show>
                                    </span>
                                    <span class="bean-tree__trailing">
                                      <Show
                                        when={[b.country, b.region]
                                          .filter(Boolean)
                                          .join(', ')}
                                      >
                                        {(meta) => (
                                          <span class="library-list__meta">
                                            {meta()}
                                          </span>
                                        )}
                                      </Show>
                                      <Show when={beanRating(b) != null}>
                                        <ShotRatingFace
                                          value={beanRating(b)}
                                          size={20}
                                        />
                                      </Show>
                                    </span>
                                  </button>
                                </li>
                              )}
                            </For>
                          </ul>
                        </details>
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
          aria-label="Bean editor"
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
            <BeanEditor
              beanId={selectedId()!}
              onClose={closeEditor}
              loadBean={props.loadBean}
              saveBean={props.saveBean}
              deleteBean={props.deleteBean}
              loadShots={props.loadShots}
              existing={existing()}
              debounceMs={props.debounceMs}
            />
          </div>
        </aside>
      </Show>
    </div>
  );
};
