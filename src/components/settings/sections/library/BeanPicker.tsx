import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import { api, type Bean } from '../../../../api';
import { groupBeansByRoaster } from '../../../../beans';
import { log } from '../../../../debugLog';

export interface BeanPickerProps {
  selectedId?: string;
  onSelect: (beanId: string) => void;
  onCancel: () => void;
  /** Test seam — defaults to the gateway's active (non-archived) beans. */
  loadBeans?: () => Promise<Bean[]>;
}

/**
 * Bean chooser for the Recipe editor, brew prep and shot-field edit. Presents
 * the same roaster tree as the Beans library (BeansSection) — roaster header
 * with bean names nested under it — plus a search box, so finding a bean is
 * consistent across the app. Lists active beans only; a recipe that already
 * points at a since-archived bean still resolves in the field row (it shows an
 * "archived" tag there), so we don't surface retired beans for new picks.
 * Mirrors ProfilePicker: single-shot load, null-on-error.
 */
export const BeanPicker: Component<BeanPickerProps> = (p) => {
  const [beans] = createResource<Bean[] | null>(() =>
    (p.loadBeans ?? (() => api.beans({})))().catch((e) => {
      log.warn('bean', 'bean load failed', e);
      return null;
    }),
  );

  const [search, setSearch] = createSignal('');

  // Filter on roaster + name + origin, then group by roaster (same ordering as
  // the library). Empty query keeps everything.
  const groups = createMemo(() => {
    const q = search().trim().toLowerCase();
    const filtered = (beans() ?? []).filter((b) => {
      if (!q) return true;
      return [b.roaster, b.name, b.country, b.region]
        .filter(Boolean)
        .some((f) => f!.toLowerCase().includes(q));
    });
    return groupBeansByRoaster(filtered);
  });

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
        <Match when={(beans() ?? []).length === 0}>
          <p class="muted">No beans yet — add one in Library → Beans.</p>
        </Match>
        <Match when={(beans() ?? []).length > 0}>
          <input
            type="text"
            class="bean-picker__search"
            data-testid="bean-picker-search"
            placeholder="Search roaster or bean…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <Show
            when={groups().length > 0}
            fallback={<p class="muted">No beans match “{search().trim()}”.</p>}
          >
            <ul class="bean-tree" data-testid="bean-picker-list">
              <For each={groups()}>
                {(group) => (
                  <li class="bean-tree__group">
                    <details open>
                      <summary class="bean-tree__roaster">
                        {group.roaster}
                      </summary>
                      <ul class="bean-tree__beans">
                        <For each={group.beans}>
                          {(b) => (
                            <li
                              class="library-list__row library-list__row--clickable"
                              classList={{
                                'library-list__row--selected':
                                  b.id === p.selectedId,
                              }}
                            >
                              <button
                                type="button"
                                class="library-list__button"
                                data-testid={`bean-pick-${b.id}`}
                                onClick={() => p.onSelect(b.id)}
                              >
                                <span class="library-list__name">
                                  {b.name}
                                  <Show when={b.decaf}>
                                    <span class="bean-tree__badge">decaf</span>
                                  </Show>
                                </span>
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
    </div>
  );
};
