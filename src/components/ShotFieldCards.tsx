import { Show, type Accessor, type Component } from 'solid-js';
import type { Bean } from '../api';
import { PickerDialog } from './PickerDialog';
import { BeanPicker } from './settings/sections/library/BeanPicker';
import { DebouncedNumberField } from './settings/sections/library/DebouncedNumberField';

/**
 * Shared shot field-cards used by both the history-detail view and the
 * post-brew summary (so the two screens render identically). The cards carry
 * the field-card chrome (matching brew-prep) and render the same way in view
 * (value) and edit (control). Save wiring stays in each host — detail batches
 * on Save, post-brew autosaves — so these are purely presentational.
 *
 * `testIdPrefix` namespaces the data-testids: `shot-detail` for the history
 * detail, `post-brew` for the result screen.
 */

export const BeanCard: Component<{
  editing: Accessor<boolean>;
  coffeeName: Accessor<string | undefined>;
  coffeeRoaster: Accessor<string | undefined>;
  onPick: () => void;
  testIdPrefix: string;
}> = (p) => (
  <div class="fieldcard">
    <span class="fieldcard__label">Bean</span>
    <Show
      when={p.editing()}
      fallback={
        <div class="fieldcard__bean" data-testid={`${p.testIdPrefix}-coffee`}>
          <Show
            when={p.coffeeName()}
            fallback={<span class="muted">No bean</span>}
          >
            <span class="fieldcard__bean-name">{p.coffeeName()}</span>
            <Show when={p.coffeeRoaster()}>
              <span
                class="fieldcard__bean-roaster"
                data-testid={`${p.testIdPrefix}-roaster`}
              >
                {p.coffeeRoaster()}
              </span>
            </Show>
          </Show>
        </div>
      }
    >
      {/* Edit re-picks the whole bean in one action — name over a muted
          roaster byline, mirroring the view layout so heights match. */}
      <button
        type="button"
        class="fieldcard__pick fieldcard__bean"
        data-testid={`${p.testIdPrefix}-bean`}
        onClick={p.onPick}
      >
        <Show
          when={p.coffeeName()}
          fallback={<span class="fieldcard__bean-name">Choose bean ▾</span>}
        >
          <span class="fieldcard__bean-name">
            {p.coffeeName()} <span class="fieldcard__caret">▾</span>
          </span>
          <Show when={p.coffeeRoaster()}>
            <span class="fieldcard__bean-roaster">{p.coffeeRoaster()}</span>
          </Show>
        </Show>
      </button>
    </Show>
  </div>
);

export const GrindCard: Component<{
  editing: Accessor<boolean>;
  grind: Accessor<number | undefined>;
  onGrind: (v: number | undefined) => void;
  testIdPrefix: string;
  debounceMs?: number;
}> = (p) => (
  <div class="fieldcard">
    <span class="fieldcard__label">Grind</span>
    <Show
      when={p.editing()}
      fallback={
        <span
          class="fieldcard__value"
          data-testid={`${p.testIdPrefix}-grind-value`}
        >
          {p.grind() ?? '—'}
        </span>
      }
    >
      <span class="fieldcard__edit">
        <DebouncedNumberField
          value={p.grind()}
          onCommit={p.onGrind}
          min={0}
          step={1}
          decimal
          steppers
          recentsKey="grinder"
          ariaLabel="Grind setting"
          testId={`${p.testIdPrefix}-grind`}
          class="rstat__input"
          debounceMs={p.debounceMs ?? 0}
        />
      </span>
    </Show>
  </div>
);

export const BeanPickerDialog: Component<{
  open: Accessor<boolean>;
  onClose: () => void;
  selectedId: Accessor<string | undefined>;
  onSelect: (id: string) => void;
  loadBeans?: () => Promise<Bean[]>;
  testId: string;
}> = (p) => (
  <PickerDialog
    open={p.open()}
    onClose={p.onClose}
    title="Choose a bean"
    description="Sets the bean recorded for this shot."
    testId={p.testId}
  >
    <BeanPicker
      selectedId={p.selectedId()}
      onSelect={p.onSelect}
      onCancel={p.onClose}
      loadBeans={p.loadBeans}
    />
  </PickerDialog>
);
