import {
  createEffect,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from 'solid-js';

export interface DebouncedNumberFieldProps {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  placeholder?: string;
  min?: number;
  step?: number;
  ariaLabel?: string;
  testId?: string;
  /** Debounce window in ms. Default 500; tests pass 0 for sync commits. */
  debounceMs?: number;
  class?: string;
  style?: JSX.CSSProperties;
}

/**
 * Number input that maintains a local string while typing and writes the
 * parsed value through `onCommit` on a debounce. Blur flushes immediately,
 * so navigating away never strands an unsaved edit.
 *
 * External value changes (e.g. a repository refetch) snap the local value
 * iff the input is not focused — that way a save round-trip mid-type
 * doesn't blow away what the user is in the middle of writing.
 *
 * Empty/whitespace → undefined; non-numeric → undefined; otherwise Number.
 */
export const DebouncedNumberField: Component<DebouncedNumberFieldProps> = (
  p,
) => {
  const [local, setLocal] = createSignal<string>(
    p.value === undefined ? '' : String(p.value),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let focused = false;

  createEffect(() => {
    const v = p.value;
    if (!focused) setLocal(v === undefined ? '' : String(v));
  });

  const parse = (raw: string): number | undefined => {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  };

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const schedule = (raw: string) => {
    clearTimer();
    const delay = p.debounceMs ?? 500;
    if (delay <= 0) {
      p.onCommit(parse(raw));
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      p.onCommit(parse(raw));
    }, delay);
  };

  const flush = (raw: string) => {
    clearTimer();
    p.onCommit(parse(raw));
  };

  onCleanup(clearTimer);

  return (
    <input
      type="number"
      inputmode="decimal"
      class={p.class}
      style={p.style}
      value={local()}
      placeholder={p.placeholder}
      min={p.min}
      step={p.step}
      aria-label={p.ariaLabel}
      data-testid={p.testId}
      onFocus={() => {
        focused = true;
      }}
      onBlur={(e) => {
        focused = false;
        flush(e.currentTarget.value);
      }}
      onInput={(e) => {
        const raw = e.currentTarget.value;
        setLocal(raw);
        schedule(raw);
      }}
    />
  );
};
