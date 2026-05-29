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
import type { Pitcher } from '../../../../domain';
import { makePitcher } from '../../../../domain';
import type { ShotSettingsSnapshot } from '../../../../snapshot';
import type { WsStream } from '../../../../streams';
import { api } from '../../../../api';
import { useRepositories } from '../../../../RepositoriesContext';
import { PitcherEditor } from './PitcherEditor';

const SHEET_ANIM_MS = 280;

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export interface SteamSectionProps {
  /** Live shotSettings stream — read to seed a new pitcher's temp + duration
   *  from the machine's current settings. Optional (tests / no machine). */
  shotSettingsStream?: WsStream<ShotSettingsSnapshot>;
  /** Machine-settings fetch for a new pitcher's flow seed. Defaults to
   *  `api.machineSettings` (null on failure). */
  loadMachineSettings?: () => Promise<{ steamFlow: number } | null>;
}

/**
 * Steam library — the user's milk Pitchers. List + side-sheet editor,
 * mirroring RecipesSection. Each pitcher carries a name, capacity, and its
 * steam parameters; recipes reference one. A `+ New Pitcher` button reveals
 * an inline name form; new pitchers seed their steam parameters from the
 * machine's current settings, then are tuned in the editor.
 */
export const SteamSection: Component<SteamSectionProps> = (props) => {
  const repos = useRepositories();
  const [pitchers, { refetch }] = createResource<Pitcher[]>(() =>
    repos.pitchers.list(),
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
    // Seed the steam parameters from the machine's current settings (temp +
    // duration off the shotSettings stream, flow from machineSettings) so a
    // new pitcher starts where the machine is, then is tuned in the editor.
    // Clamp into the slider ranges; fall back to sensible defaults.
    const ss = props.shotSettingsStream?.latest();
    const ms = await (
      props.loadMachineSettings ??
      (() => api.machineSettings().catch(() => null))
    )();
    const pitcher = makePitcher({
      name,
      capacityMl: 350,
      steamDurationSec: clamp(ss?.targetSteamDuration ?? 30, 5, 120),
      steamTempC: clamp(ss?.targetSteamTemp ?? 150, 130, 170),
      steamFlow: clamp(ms?.steamFlow ?? 0.8, 0.4, 2),
    });
    await repos.pitchers.create(pitcher);
    setCreating(false);
    setDraftName('');
    await refetch();
    openEditor(pitcher.id);
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
          aria-labelledby="library-steam-heading"
        >
          <h2 id="library-steam-heading">Steam</h2>
          <p class="settings-help">
            Your milk pitchers. Each has a capacity and its own steam settings;
            a recipe picks which pitcher to steam with.
          </p>

          <Show
            when={creating()}
            fallback={
              <button
                type="button"
                class="btn routines-section__add-btn"
                data-testid="open-new-pitcher"
                onClick={openCreate}
              >
                + New Pitcher
              </button>
            }
          >
            <form
              class="routines-section__add-form"
              data-testid="new-pitcher-form"
              onSubmit={submitCreate}
            >
              <input
                ref={(el) => (nameInputRef = el)}
                type="text"
                class="routines-section__add-input"
                placeholder="Pitcher name"
                aria-label="New pitcher name"
                data-testid="new-pitcher-name"
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
                data-testid="confirm-new-pitcher"
                disabled={draftName().trim().length === 0}
              >
                Create
              </button>
              <button
                type="button"
                class="btn"
                data-testid="cancel-new-pitcher"
                onClick={cancelCreate}
              >
                Cancel
              </button>
            </form>
          </Show>

          <Switch>
            <Match when={pitchers.loading}>
              <p class="muted">loading pitchers…</p>
            </Match>
            <Match when={pitchers.error}>
              <p class="muted" role="alert">
                failed to load pitchers
              </p>
            </Match>
            <Match when={pitchers()}>
              <Show
                when={(pitchers() ?? []).length > 0}
                fallback={<p class="muted">no pitchers yet</p>}
              >
                <ul class="library-list" data-testid="pitchers-list">
                  <For each={pitchers()}>
                    {(pt) => (
                      <li class="library-list__row library-list__row--clickable">
                        <button
                          type="button"
                          class="library-list__button"
                          data-testid={`pitcher-row-${pt.id}`}
                          onClick={() => openEditor(pt.id)}
                        >
                          <span class="library-list__name">{pt.name}</span>
                          <span class="library-list__meta">
                            {pt.capacityMl} mL · {pt.steamDurationSec} s ·{' '}
                            {pt.steamTempC} °C · {pt.steamFlow.toFixed(1)} mL/s
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
          aria-label="Pitcher editor"
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
            <PitcherEditor pitcherId={selectedId()!} onClose={closeEditor} />
          </div>
        </aside>
      </Show>
    </div>
  );
};
