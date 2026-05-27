import { For, type Accessor, type Component } from 'solid-js';
import { CupIcon, SteamIcon, WaterDropIcon, FlushIcon, type IconProps } from './icons';

/**
 * The four machine operations a Recipe is built from, run directly — no
 * recipe, no curation. A slim tray pinned under the Recipe picker on Home
 * (see Home's left column). Tapping an op:
 *   - brew  → opens the ad-hoc brew prep → live → summary (App).
 *   - steam / water / flush → start immediately; the LiveBrewDrawer shows
 *     the live view and closes when the machine returns to idle (App calls
 *     `requestState`).
 *
 * Defaults come from current gateway state (the brew prep reads the current
 * workflow; steam/water/flush use the firmware settings), so there's nothing
 * to configure here — just four buttons.
 */
export type ExploreOp = 'brew' | 'steam' | 'water' | 'flush';

const OPS: { op: ExploreOp; label: string; icon: Component<IconProps> }[] = [
  { op: 'brew', label: 'Brew', icon: CupIcon },
  { op: 'steam', label: 'Steam', icon: SteamIcon },
  { op: 'water', label: 'Hot Water', icon: WaterDropIcon },
  { op: 'flush', label: 'Flush', icon: FlushIcon },
];

export interface ExploreTrayProps {
  /** Invoked with the chosen op. Brew routes to prep; the rest start live. */
  onSelect: (op: ExploreOp) => void;
  /** When true, all tiles disable (e.g. the tank is below the block level —
   *  every op needs water). */
  disabled?: Accessor<boolean>;
}

export const ExploreTray: Component<ExploreTrayProps> = (p) => {
  const disabled = (): boolean => p.disabled?.() ?? false;
  return (
    <section class="explore-tray" aria-label="Explore — run a machine action directly">
      <span class="explore-tray__label">Explore</span>
      <div class="explore-tray__tiles">
        <For each={OPS}>
          {(o) => {
            const Icon = o.icon;
            return (
              <button
                type="button"
                class="explore-tile"
                data-op={o.op}
                data-testid={`explore-${o.op}`}
                disabled={disabled()}
                onClick={() => p.onSelect(o.op)}
              >
                <span class="explore-tile__icon" aria-hidden="true">
                  <Icon size={26} />
                </span>
                <span class="explore-tile__label">{o.label}</span>
              </button>
            );
          }}
        </For>
      </div>
    </section>
  );
};
