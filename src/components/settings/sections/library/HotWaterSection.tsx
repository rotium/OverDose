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
import { makeVessel, VESSEL_FLOW_MAX, VESSEL_FLOW_MIN } from '../../../../domain';
import { useRepositories } from '../../../../RepositoriesContext';
import { VesselEditor } from './VesselEditor';

const SHEET_ANIM_MS = 280;

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/**
 * Hot Water library — the user's Vessels. List + side-sheet editor, mirroring
 * SteamSection. Each vessel carries a name (its size), a capacity and a flow;
 * a recipe's water step references one and adds the pour itself.
 *
 * Nothing is read from the machine when creating one. A new vessel is a
 * different size by definition, so there is nothing worth copying off the
 * current hot-water settings — and it would have cost a BLE MMR read.
 */
export const HotWaterSection: Component = () => {
  const repos = useRepositories();
  // Sourced on `repos.revision` so a gateway sync pull re-runs the list.
  const [vessels, { refetch }] = createResource(repos.revision, () =>
    repos.vessels.list(),
  );

  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [animatingOut, setAnimatingOut] = createSignal(false);
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
    const vessel = makeVessel({
      name,
      capacityMl: 250,
      flow: clamp(6, VESSEL_FLOW_MIN, VESSEL_FLOW_MAX),
    });
    await repos.vessels.create(vessel);
    setCreating(false);
    setDraftName('');
    await refetch();
    openEditor(vessel.id);
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
          aria-labelledby="library-hotwater-heading"
        >
          <h2 id="library-hotwater-heading">Hot Water</h2>
          <p class="settings-help">
            The cups, mugs and teapots you pour into. Each has a size and a
            flow; a recipe's water step picks one and says how much to pour.
          </p>

          <Show
            when={creating()}
            fallback={
              <button
                type="button"
                class="btn routines-section__add-btn"
                data-testid="open-new-vessel"
                onClick={openCreate}
              >
                + New Vessel
              </button>
            }
          >
            <form
              class="routines-section__add-form"
              data-testid="new-vessel-form"
              onSubmit={submitCreate}
            >
              <input
                ref={(el) => (nameInputRef = el)}
                type="text"
                class="routines-section__add-input"
                placeholder="Vessel name"
                aria-label="New vessel name"
                data-testid="new-vessel-name"
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
                data-testid="confirm-new-vessel"
                disabled={draftName().trim().length === 0}
              >
                Create
              </button>
              <button
                type="button"
                class="btn"
                data-testid="cancel-new-vessel"
                onClick={cancelCreate}
              >
                Cancel
              </button>
            </form>
          </Show>

          <Switch>
            <Match when={vessels.loading}>
              <p class="muted">loading vessels…</p>
            </Match>
            <Match when={vessels.error}>
              <p class="muted" role="alert">
                failed to load vessels
              </p>
            </Match>
            <Match when={vessels()}>
              <Show
                when={(vessels() ?? []).length > 0}
                fallback={<p class="muted">no vessels yet</p>}
              >
                <ul class="library-list" data-testid="vessels-list">
                  <For each={vessels()}>
                    {(v) => (
                      <li class="library-list__row library-list__row--clickable">
                        <button
                          type="button"
                          class="library-list__button"
                          data-testid={`vessel-row-${v.id}`}
                          onClick={() => openEditor(v.id)}
                        >
                          <span class="library-list__name">{v.name}</span>
                          <span class="library-list__meta">
                            {v.capacityMl} mL · {v.flow.toFixed(1)} mL/s
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
          aria-label="Vessel editor"
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
            <VesselEditor vesselId={selectedId()!} onClose={closeEditor} />
          </div>
        </aside>
      </Show>
    </div>
  );
};
