import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  type Accessor,
  type Component,
  type Resource,
} from 'solid-js';
import type { Workflow } from '../domain';
import type { WorkflowRepository } from '../repositories';
import { WorkflowTile, type DisabledReason } from './WorkflowTile';

/**
 * Workflow picker grid. Loads workflows from the injected repository and
 * renders one WorkflowTile each. Tapping a tile invokes `onSelect` — the
 * parent decides what happens (route to the runtime wizard, etc.).
 *
 * The repository is injected, not imported, so tests can pass an in-memory
 * fake without touching real storage. See [[starter-skin-storage]].
 *
 * `refresh` is exposed for callers that mutate the library (e.g. after the
 * user creates a Workflow in the editor) and want the picker to re-pull.
 *
 * `disabledReason` (accessor, optional) gates the whole grid — when it returns
 * a non-null value all tiles render disabled with the matching reason icon
 * (e.g. low-water blocking). Driven by the parent so the rule (which signal,
 * which threshold) lives there, not here.
 */
export interface WorkflowPickerProps {
  repository: WorkflowRepository;
  onSelect: (workflow: Workflow) => void;
  disabledReason?: Accessor<DisabledReason | null>;
}

export interface WorkflowPickerHandle {
  workflows: Resource<Workflow[]>;
  refresh: () => void;
}

export const WorkflowPicker: Component<
  WorkflowPickerProps & { ref?: (h: WorkflowPickerHandle) => void }
> = (p) => {
  const [workflows, { refetch }] = createResource(() => p.repository.list());
  p.ref?.({ workflows, refresh: () => void refetch() });

  return (
    <section class="picker" aria-label="Workflow picker">
      <Switch>
        <Match when={workflows.loading}>
          <p class="muted">loading workflows…</p>
        </Match>
        <Match when={workflows.error}>
          <p class="muted" role="alert">
            failed to load workflows
          </p>
        </Match>
        <Match when={workflows()}>
          <Show
            when={(workflows() ?? []).length > 0}
            fallback={
              <p class="muted">
                no workflows yet — add one from the menu
              </p>
            }
          >
            <div class="picker__grid" data-testid="picker-grid">
              <For each={workflows()}>
                {(w) => {
                  const reason = () => p.disabledReason?.() ?? null;
                  return (
                    <WorkflowTile
                      workflow={w}
                      onSelect={p.onSelect}
                      disabled={reason() !== null}
                      disabledReason={reason() ?? undefined}
                    />
                  );
                }}
              </For>
            </div>
          </Show>
        </Match>
      </Switch>
    </section>
  );
};

/** Test helper: convenience accessor for the workflows resource. */
export const useWorkflows = (h: WorkflowPickerHandle): Accessor<Workflow[]> =>
  () => h.workflows() ?? [];
