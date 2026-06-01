import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  type Component,
} from 'solid-js';
import { api, type Bean } from '../../../../api';

export interface BeanPickerProps {
  selectedId?: string;
  onSelect: (beanId: string) => void;
  onCancel: () => void;
  /** Test seam — defaults to the gateway's active (non-archived) beans. */
  loadBeans?: () => Promise<Bean[]>;
}

/**
 * Bean chooser for the Recipe editor. A flat list (not the editor's roaster
 * tree) sorted alphabetically — picking is a quick one-tap choice and few
 * beans are active at once. Lists active beans only; a recipe that already
 * points at a since-archived bean still resolves in the field row (it shows
 * an "archived" tag there), so we don't surface retired beans for new picks.
 * Mirrors ProfilePicker: single-shot load, null-on-error.
 */
export const BeanPicker: Component<BeanPickerProps> = (p) => {
  const [beans] = createResource<Bean[] | null>(() =>
    (p.loadBeans ?? (() => api.beans({})))().catch((e) => {
      console.warn('bean load failed', e);
      return null;
    }),
  );

  const sorted = createMemo(() =>
    (beans() ?? [])
      .slice()
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.roaster.localeCompare(b.roaster),
      ),
  );

  return (
    <div class="bean-picker" data-testid="bean-picker">
      <Switch>
        <Match when={beans.loading}>
          <p class="muted">Loading beans…</p>
        </Match>
        <Match when={beans() === null}>
          <p class="muted" role="alert">
            Couldn't load beans — check the gateway connection.
          </p>
        </Match>
        <Match when={sorted().length === 0}>
          <p class="muted">No beans yet — add one in Library → Beans.</p>
        </Match>
        <Match when={sorted().length > 0}>
          <ul class="library-list" data-testid="bean-picker-list">
            <For each={sorted()}>
              {(b) => (
                <li
                  class="library-list__row library-list__row--clickable"
                  classList={{
                    'library-list__row--selected': b.id === p.selectedId,
                  }}
                >
                  <button
                    type="button"
                    class="library-list__button"
                    data-testid={`bean-pick-${b.id}`}
                    onClick={() => p.onSelect(b.id)}
                  >
                    <span class="library-list__name">
                      {b.roaster} — {b.name}
                      <Show when={b.decaf}>
                        <span class="bean-tree__badge">decaf</span>
                      </Show>
                    </span>
                    <Show
                      when={[b.country, b.processing].filter(Boolean).join(' · ')}
                    >
                      {(meta) => (
                        <span class="library-list__meta">{meta()}</span>
                      )}
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </div>
  );
};
