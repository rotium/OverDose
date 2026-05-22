import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { Workflow } from '../domain';
import { WaterDropIcon } from './icons';

export type DisabledReason = 'low-water';

/**
 * Single tile in the Workflow picker grid. Big-tap-target on tablet; the whole
 * tile is one button — no nested clickables.
 *
 * When `disabled` is set, the tile renders as inert and surfaces a small icon
 * indicating the reason (e.g. droplet for low-water block).
 */
export interface WorkflowTileProps {
  workflow: Workflow;
  onSelect: (workflow: Workflow) => void;
  disabled?: boolean;
  disabledReason?: DisabledReason;
}

const reasonLabel: Record<DisabledReason, string> = {
  'low-water': 'Refill water tank',
};

export const WorkflowTile: Component<WorkflowTileProps> = (p) => {
  const reasonText = () => (p.disabledReason ? reasonLabel[p.disabledReason] : undefined);

  return (
    <button
      type="button"
      class="tile"
      classList={{ 'tile--disabled': !!p.disabled }}
      onClick={() => p.onSelect(p.workflow)}
      disabled={p.disabled}
      aria-disabled={p.disabled}
      title={p.disabled ? reasonText() : undefined}
      data-testid={`workflow-tile-${p.workflow.id}`}
    >
      <Show when={p.workflow.iconUrl}>
        <img class="tile__icon" src={p.workflow.iconUrl} alt="" />
      </Show>
      <span class="tile__name">{p.workflow.name}</span>
      <Show when={p.disabled && p.disabledReason === 'low-water'}>
        <span
          class="tile__reason"
          aria-label={reasonText()}
          data-testid={`workflow-tile-${p.workflow.id}-reason`}
        >
          <WaterDropIcon class="tile__reason-icon" size={20} />
        </span>
      </Show>
    </button>
  );
};
