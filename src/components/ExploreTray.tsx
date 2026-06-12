import { For, Show, type Accessor, type Component } from 'solid-js';
import type { Cleaning } from '../domain';
import { CleaningKindIcon } from './CleaningKindIcon';
import {
  ClockIcon,
  CupIcon,
  PowerIcon,
  SteamIcon,
  WaterDropIcon,
  FlushIcon,
  type IconProps,
} from './icons';

/**
 * The four machine operations a Recipe is built from, run directly — no
 * recipe, no curation. A slim tray pinned under the Recipe picker on Home
 * (see Home's left column). Tapping an op:
 *   - brew  → opens the ad-hoc brew prep → live → summary (App). Always
 *             enabled; gating happens at the prep-screen Start button.
 *   - steam / water / flush → start the action immediately (no prep
 *             intermediate). These are blocked when the machine isn't
 *             ready, with an icon explaining why.
 *
 * Defaults come from current gateway state (the brew prep reads the current
 * workflow; steam/water/flush use the firmware settings), so there's nothing
 * to configure here — just four buttons.
 */
export type ExploreOp = 'brew' | 'steam' | 'water' | 'flush';

/**
 * Reasons the direct-op tiles (steam/water/flush) can be disabled. The
 * brew tile is always enabled — its action is the prep-screen Start
 * button, which has its own gating.
 */
export type ExploreBlockReason = 'water-critical' | 'heater-off';

const OPS: { op: ExploreOp; label: string; icon: Component<IconProps> }[] = [
  { op: 'brew', label: 'Brew', icon: CupIcon },
  { op: 'steam', label: 'Steam', icon: SteamIcon },
  { op: 'water', label: 'Hot Water', icon: WaterDropIcon },
  { op: 'flush', label: 'Flush', icon: FlushIcon },
];

const REASON_ICON: Record<ExploreBlockReason, Component<IconProps>> = {
  'water-critical': WaterDropIcon,
  'heater-off': PowerIcon,
};

const REASON_LABEL: Record<ExploreBlockReason, string> = {
  'water-critical': 'Refill water tank',
  'heater-off': 'Heater off',
};

export interface ExploreTrayProps {
  /** Invoked with the chosen op. Brew routes to prep; the rest start live. */
  onSelect: (op: ExploreOp) => void;
  /** When non-null, the steam/water/flush tiles render disabled with an
   *  icon explaining why. The brew tile is unaffected — its prep-screen
   *  Start does its own gating. */
  blockReason?: Accessor<ExploreBlockReason | null>;
  /** Home-visible (non-hidden) cleanings, rendered after a divider as
   *  quick-launch tiles. Tapping one opens its wizard directly (like Brew,
   *  always enabled — readiness gating happens inside the wizard). */
  cleanings?: Accessor<Cleaning[]>;
  /** Ids of cleanings currently due — their tile gets the accent highlight
   *  + a clock badge. */
  dueCleaningIds?: Accessor<Set<string>>;
  /** Launch a cleaning's wizard. */
  onRunCleaning?: (c: Cleaning) => void;
}

export const ExploreTray: Component<ExploreTrayProps> = (p) => {
  const reason = (): ExploreBlockReason | null => p.blockReason?.() ?? null;
  const cleanings = (): Cleaning[] => p.cleanings?.() ?? [];
  const isDue = (id: string): boolean => p.dueCleaningIds?.().has(id) ?? false;
  return (
    <section class="explore-tray" aria-label="Run a machine action or cleaning directly">
      <div class="explore-tray__tiles">
        <For each={OPS}>
          {(o) => {
            const Icon = o.icon;
            const isDirect = o.op !== 'brew';
            const isDisabled = () => isDirect && reason() !== null;
            const ReasonIcon = () => {
              const r = reason();
              if (!r) return null;
              const I = REASON_ICON[r];
              return <I size={16} />;
            };
            return (
              <button
                type="button"
                class="explore-tile"
                data-op={o.op}
                data-block-reason={isDisabled() ? (reason() ?? undefined) : undefined}
                data-testid={`explore-${o.op}`}
                disabled={isDisabled()}
                aria-disabled={isDisabled()}
                title={isDisabled() ? REASON_LABEL[reason()!] : undefined}
                onClick={() => p.onSelect(o.op)}
              >
                <span class="explore-tile__icon" aria-hidden="true">
                  <Icon size={26} />
                </span>
                <span class="explore-tile__label">{o.label}</span>
                <Show when={isDisabled()}>
                  <span
                    class="explore-tile__reason"
                    aria-label={REASON_LABEL[reason()!]}
                    data-testid={`explore-${o.op}-reason`}
                  >
                    <ReasonIcon />
                  </span>
                </Show>
              </button>
            );
          }}
        </For>

        {/* Saved cleanings you run regularly — same tile, after a divider.
            Tapping opens the wizard directly; due ones glow + show a clock. */}
        <Show when={cleanings().length > 0}>
          <span class="explore-tray__divider" aria-hidden="true" />
          <For each={cleanings()}>
            {(c) => (
              <button
                type="button"
                class="explore-tile"
                data-due={isDue(c.id) ? 'true' : undefined}
                data-testid={`explore-cleaning-${c.id}`}
                onClick={() => p.onRunCleaning?.(c)}
              >
                <span class="explore-tile__icon" aria-hidden="true">
                  <CleaningKindIcon kind={c.operation.kind} size={26} />
                </span>
                <span class="explore-tile__label">{c.name}</span>
                <Show when={isDue(c.id)}>
                  <span
                    class="explore-tile__reason"
                    aria-label="Due"
                    data-testid={`explore-cleaning-${c.id}-due`}
                  >
                    <ClockIcon size={16} />
                  </span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
};
