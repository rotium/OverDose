import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  type Component,
} from 'solid-js';
import { useRepositories } from '../../../../RepositoriesContext';

/**
 * Beverages list (read-only for now — editor lands in Phase 3). Each row
 * shows the Beverage name and step count. Reads via `listVisible()` so
 * hidden detach-clones don't show up; the runtime still resolves them via
 * `get(id)` regardless of visibility.
 */
export const BeveragesSection: Component = () => {
  const repos = useRepositories();
  const [beverages] = createResource(() => repos.beverages.listVisible());

  return (
    <div class="settings-section-stack">
      <section
        class="settings-section"
        aria-labelledby="library-beverages-heading"
      >
        <h2 id="library-beverages-heading">Beverages</h2>
        <p class="settings-help">
          How you brew each drink — a sequence of steps with default values
          that all Recipes for this Beverage inherit.
        </p>

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
                    <li
                      class="library-list__row"
                      data-testid={`beverage-row-${b.id}`}
                    >
                      <span class="library-list__name">{b.name}</span>
                      <span class="library-list__meta">
                        {b.steps.length} step{b.steps.length === 1 ? '' : 's'}
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
