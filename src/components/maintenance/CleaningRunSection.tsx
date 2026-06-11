import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  type Component,
} from 'solid-js';
import type { Cleaning } from '../../domain';
import { cleaningDue, operationSummary } from '../../domain';
import { useRepositories } from '../../RepositoriesContext';
import { CleaningKindIcon } from '../CleaningKindIcon';

export interface CleaningRunSectionProps {
  /** Launch a cleaning's runtime (the wizard). When omitted, Run is disabled
   *  ("coming soon") — the wizard isn't wired yet. */
  onRun?: (cleaning: Cleaning) => void;
}

/**
 * Maintenance → Cleaning: the **run** surface. Lists every cleaning (including
 * hidden ones — `hidden` only affects Home quick-buttons, not this list) with a
 * Run action. Configuration lives in Library → Cleanings; this is where you
 * trigger them. See docs/plans/cleaning-feature.md.
 */
export const CleaningRunSection: Component<CleaningRunSectionProps> = (p) => {
  const repos = useRepositories();
  const [cleanings] = createResource(repos.revision, () =>
    repos.cleanings.list(),
  );

  // Acknowledge a due reminder without running it — "I did it by hand / skip
  // this one". Only offered while a cleaning is actually due (no point when the
  // next alert is hours away). Stamps the ack clock; the revision bump clears
  // the row's due state + the Home pill.
  const dismiss = (c: Cleaning) =>
    void repos.cleanings
      .update({ ...c, lastDoneAt: new Date().toISOString() })
      .catch((e) => console.warn('dismiss reminder failed', e));

  return (
    <div class="settings-section-stack">
      <section class="settings-section" aria-labelledby="maintenance-cleaning-heading">
        <h2 id="maintenance-cleaning-heading">Cleaning</h2>
        <p class="settings-help">
          Run a cleaning. Configure them in Library → Cleanings.
        </p>

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
              <ul class="library-list" data-testid="run-cleanings-list">
                <For each={cleanings()}>
                  {(c) => {
                    const due = () => cleaningDue(c, { now: Date.now() });
                    return (
                      <li
                        class="library-list__row"
                        data-testid={`run-cleaning-row-${c.id}`}
                      >
                        <div class="library-list__main">
                          <span class="library-list__name">
                            <CleaningKindIcon kind={c.operation.kind} /> {c.name}
                          </span>
                          <span class="library-list__meta recipes-section__meta">
                            <span class="recipes-section__routine">
                              {due().label}
                              <Show when={due().due}>
                                {' '}
                                <span class="cleanings-section__due">● due</span>
                              </Show>
                            </span>
                            <span class="recipes-section__sequence">
                              {operationSummary(c.operation)}
                            </span>
                          </span>
                        </div>
                        <div class="run-cleaning__actions">
                          <Show when={due().due}>
                            <button
                              type="button"
                              class="btn"
                              data-testid={`dismiss-cleaning-${c.id}`}
                              title="Clear this reminder without running it"
                              onClick={() => dismiss(c)}
                            >
                              Dismiss
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="btn"
                            data-testid={`run-cleaning-${c.id}`}
                            disabled={!p.onRun}
                            title={p.onRun ? undefined : 'Coming soon'}
                            onClick={() => p.onRun?.(c)}
                          >
                            Run
                          </button>
                        </div>
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
  );
};
