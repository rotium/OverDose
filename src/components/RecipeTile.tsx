import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { Recipe } from '../domain';

/**
 * Single tile in the Recipe picker grid. Big-tap-target on tablet; the whole
 * tile is one button — no nested clickables.
 *
 * Always navigable — "not ready" gating (low water, heater off, warming up)
 * happens at the prep-screen Start button, not here. The Recipe picker lets
 * the user browse and queue up a recipe even if the machine isn't ready yet.
 *
 * `profileTitle` is an optional subtitle rendered beneath the recipe name —
 * "how this shot is pulled" (e.g. "Best Practice C+"). Picker resolves the
 * title from the gateway's profile list; when missing or the gateway is
 * offline, the tile just renders the recipe name without a subtitle.
 */
export interface RecipeTileProps {
  recipe: Recipe;
  onSelect: (recipe: Recipe) => void;
  /** Optional profile name shown muted under the recipe name. */
  profileTitle?: string;
}

export const RecipeTile: Component<RecipeTileProps> = (p) => (
  <button
    type="button"
    class="tile"
    onClick={() => p.onSelect(p.recipe)}
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
  </button>
);
