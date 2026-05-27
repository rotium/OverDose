import {
  createEffect,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from 'solid-js';

export interface DebouncedSliderFieldProps {
  value: number | undefined;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  ariaLabel?: string;
  testId?: string;
  /** Debounce window in ms. Default 250; tests pass 0 for sync commits. */
  debounceMs?: number;
  class?: string;
  style?: JSX.CSSProperties;
  /** Renderer for the inline value label, e.g. `(v) => `${v.toFixed(1)} mL/s``.
   *  Default formats with 1 decimal. */
  formatValue?: (v: number) => string;
  /** Disabled state — slider becomes read-only and dims. */
  disabled?: boolean;
}

/**
 * Range slider that mirrors DebouncedNumberField's commit semantics:
 *
 *   - Local value updates instantly on input (so the thumb tracks the drag).
 *   - Debounced commit fires after the drag settles.
 *   - Pointer-up / change flushes immediately (so a quick click-and-release
 *     doesn't wait for the debounce).
 *   - External `value` changes snap the local value iff the user isn't
 *     currently interacting (mirrors the focused-flag pattern in the number
 *     field — refetches mid-drag don't yank the thumb away).
 *
 * Default value: when `value` is undefined, the slider falls back to `min`
 * but does NOT commit anything on its own. The first commit happens only
 * after the user actually moves it. That keeps a "haven't loaded yet"
 * render from accidentally writing a value back to the gateway.
 */
export const DebouncedSliderField: Component<DebouncedSliderFieldProps> = (p) => {
  const fallback = () => p.min;
  const [local, setLocal] = createSignal<number>(p.value ?? fallback());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interacting = false;
  // Last value actually pushed via onCommit. A range input fires BOTH
  // `pointerup` and `change` on release (and a debounced `input` may have
  // already committed the same value), so a single drag would otherwise fire
  // onCommit two or three times — and every commit here is a gateway write.
  // Dedupe consecutive identical commits so one adjustment = one write.
  let lastCommitted = p.value;

  createEffect(() => {
    const v = p.value;
    if (!interacting && v !== undefined) {
      setLocal(v);
      // Keep the dedupe baseline in sync with confirmed external values
      // (e.g. a post-write refetch) so re-selecting that value later still
      // commits when intended.
      lastCommitted = v;
    }
  });

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const commit = (n: number) => {
    if (n === lastCommitted) return;
    lastCommitted = n;
    p.onCommit(n);
  };

  const schedule = (n: number) => {
    clearTimer();
    const delay = p.debounceMs ?? 250;
    if (delay <= 0) {
      commit(n);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      commit(n);
    }, delay);
  };

  const flush = (n: number) => {
    clearTimer();
    commit(n);
  };

  onCleanup(clearTimer);

  const fmt = (v: number) =>
    (p.formatValue ?? ((x: number) => x.toFixed(1)))(v);

  return (
    <div class={`slider-field ${p.class ?? ''}`}>
      <input
        type="range"
        class="slider-field__input"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={local()}
        disabled={p.disabled}
        aria-label={p.ariaLabel}
        data-testid={p.testId}
        onPointerDown={() => {
          interacting = true;
        }}
        onPointerUp={(e) => {
          interacting = false;
          flush(Number(e.currentTarget.value));
        }}
        onPointerCancel={() => {
          interacting = false;
        }}
        onInput={(e) => {
          const n = Number(e.currentTarget.value);
          setLocal(n);
          schedule(n);
        }}
        onChange={(e) => {
          // Fires on keyboard arrow / tab-then-arrow. PointerUp covers
          // mouse / touch; `change` covers keyboard. Either way: flush.
          interacting = false;
          flush(Number(e.currentTarget.value));
        }}
      />
      <output
        class="slider-field__value"
        data-testid={p.testId ? `${p.testId}-value` : undefined}
        for={p.testId}
      >
        {fmt(local())}
      </output>
    </div>
  );
};
