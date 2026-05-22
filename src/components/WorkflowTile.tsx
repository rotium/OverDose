import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { Workflow } from '../domain';

/**
 * Single tile in the Workflow picker grid. Big-tap-target on tablet; the whole
 * tile is one button — no nested clickables.
 */
export interface WorkflowTileProps {
  workflow: Workflow;
  onSelect: (workflow: Workflow) => void;
}

export const WorkflowTile: Component<WorkflowTileProps> = (p) => (
  <button
    type="button"
    class="tile"
    onClick={() => p.onSelect(p.workflow)}
    data-testid={`workflow-tile-${p.workflow.id}`}
  >
    <Show when={p.workflow.iconUrl}>
      <img class="tile__icon" src={p.workflow.iconUrl} alt="" />
    </Show>
    <span class="tile__name">{p.workflow.name}</span>
  </button>
);
