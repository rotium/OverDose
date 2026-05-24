import { Show, type Component } from 'solid-js';
import type { BeverageStep, SteamConfig } from '../../../../domain';
import { DebouncedNumberField } from './DebouncedNumberField';

export interface StepConfigFieldsProps {
  step: BeverageStep;
  /** Called with the new whole config object for this step. */
  onCommit: (config: BeverageStep['config']) => void;
  /** Debounce override for tests. */
  debounceMs?: number;
}

const DEFAULT_AUTO_PURGE_SEC = 5;

/**
 * Per-step config controls. Only the steam step has any Beverage-level
 * parameters today: a radio between Auto Purge (with a delay in seconds)
 * and Manual Purge. Brew / Water / Flush render nothing — their per-shot
 * tunables live on the Recipe + Profile, not the Beverage.
 *
 * The radio's selected state is derived from `autoPurgeTimeSec`:
 * `> 0` ⇒ Auto, anything else ⇒ Manual. Clicking Auto with no existing
 * time seeds a 5-second default. Clicking Manual clears the time field.
 * Clearing the time input via the keyboard returns the row to Manual,
 * since "auto-purge with zero delay" is not a meaningful state.
 */
export const StepConfigFields: Component<StepConfigFieldsProps> = (p) => {
  const steamCfg = (): SteamConfig | null =>
    p.step.type === 'steam' ? (p.step.config as SteamConfig) : null;

  const isAuto = (): boolean => (steamCfg()?.autoPurgeTimeSec ?? 0) > 0;

  const selectAuto = () => {
    if (isAuto()) return;
    p.onCommit({
      ...steamCfg(),
      autoPurgeTimeSec: DEFAULT_AUTO_PURGE_SEC,
    } satisfies SteamConfig);
  };

  const selectManual = () => {
    if (!isAuto()) return;
    p.onCommit({
      ...steamCfg(),
      autoPurgeTimeSec: undefined,
    } satisfies SteamConfig);
  };

  const radioName = () => `purge-${p.step.id}`;

  return (
    <Show when={p.step.type === 'steam'}>
      <fieldset
        class="step-purge"
        data-testid={`step-${p.step.id}-purge-mode`}
      >
        <legend class="visually-hidden">Steam purge mode</legend>
        <label class="step-purge__option">
          <input
            type="radio"
            name={radioName()}
            checked={isAuto()}
            data-testid={`step-${p.step.id}-purge-auto`}
            onChange={selectAuto}
          />
          <span class="step-purge__heading">
            <span class="step-purge__title">Auto Purge</span>
            <Show when={isAuto()}>
              <span class="step-field">
                <span class="step-field__label">Time to Purge</span>
                <DebouncedNumberField
                  value={steamCfg()?.autoPurgeTimeSec}
                  onCommit={(v) =>
                    p.onCommit({
                      ...steamCfg(),
                      autoPurgeTimeSec: v,
                    } satisfies SteamConfig)
                  }
                  placeholder="s"
                  min={0}
                  step={1}
                  ariaLabel="Time to purge (seconds)"
                  testId={`step-${p.step.id}-purge-time`}
                  debounceMs={p.debounceMs}
                  class="step-field__input"
                />
                <span class="step-field__unit">s</span>
              </span>
            </Show>
          </span>
          <p class="step-purge__help">
            After steaming ends, the machine waits this many seconds and
            then flushes water through the group head to clear milk
            splatter. The delay lets you wipe the steam wand first.
          </p>
        </label>
        <label class="step-purge__option">
          <input
            type="radio"
            name={radioName()}
            checked={!isAuto()}
            data-testid={`step-${p.step.id}-purge-manual`}
            onChange={selectManual}
          />
          <span class="step-purge__heading">
            <span class="step-purge__title">Manual Purge</span>
          </span>
          <p class="step-purge__help">
            The machine doesn't auto-purge. You press the purge button on
            the machine yourself when you're ready.
          </p>
        </label>
      </fieldset>
    </Show>
  );
};
