import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { Recipe } from '../domain';
import { WaterDropIcon } from './icons';

export type DisabledReason = 'low-water';

/**
 * Single tile in the Recipe picker grid. Big-tap-target on tablet; the whole
 * tile is one button — no nested clickables.
 *
 * When `disabled` is set, the tile renders as inert and surfaces a small icon
 * indicating the reason (e.g. droplet for low-water block).
 *
 * `profileTitle` is an optional subtitle rendered beneath the recipe name —
 * "how this shot is pulled" (e.g. "Best Practice C+"). Picker resolves the
 * title from the gateway's profile list; when missing or the gateway is
 * offline, the tile just renders the recipe name without a subtitle.
 */
export interface RecipeTileProps {
  recipe: Recipe;
  onSelect: (recipe: Recipe) => void;
  disabled?: boolean;
  disabledReason?: DisabledReason;
  /** Optional profile name shown muted under the recipe name. */
  profileTitle?: string;
}

const reasonLabel: Record<DisabledReason, string> = {
  'low-water': 'Refill water tank',
};

export const RecipeTile: Component<RecipeTileProps> = (p) => {
  const reasonText = () => (p.disabledReason ? reasonLabel[p.disabledReason] : undefined);

  return (
    <button
      type="button"
      class="tile"
      classList={{ 'tile--disabled': !!p.disabled }}
      onClick={() => p.onSelect(p.recipe)}
      disabled={p.disabled}
      aria-disabled={p.disabled}
      title={p.disabled ? reasonText() : undefined}
      data-testid={`recipe-tile-${p.recipe.id}`}
    >
      <Show when={p.recipe.iconUrl}>
        <img class="tile__icon" src={p.recipe.iconUrl} alt="" />
      </Show>
      <span class="tile__name">{p.recipe.name}</span>
      <Show when={p.profileTitle}>
        <span
          class="tile__profile"
          data-testid={`recipe-tile-${p.recipe.id}-profile`}
        >
          {p.profileTitle}
        </span>
      </Show>
      <Show when={p.disabled && p.disabledReason === 'low-water'}>
        <span
          class="tile__reason"
          aria-label={reasonText()}
          data-testid={`recipe-tile-${p.recipe.id}-reason`}
        >
          <WaterDropIcon class="tile__reason-icon" size={20} />
        </span>
      </Show>
    </button>
  );
};
