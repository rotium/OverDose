import {
  createEffect,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from 'solid-js';
import {
  openKeypad,
  closeKeypad,
  requestCloseKeypad,
  type KeypadController,
} from '../../../../numericKeypad';

export interface DebouncedNumberFieldProps {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  /** Stepper increment (and the legacy fractional hint). Default 1. */
  step?: number;
  /** Whether the keypad allows a decimal point. Defaults to inferring from
   *  `step` (`< 1` → decimals) for back-compat; set explicitly to decouple
   *  the decimal key from the stepper increment (e.g. nudge by 1 but still
   *  type 18.5). */
  decimal?: boolean;
  ariaLabel?: string;
  /** Unit shown beside the value in the keypad readout (e.g. "g", "mL"). */
  unit?: string;
  testId?: string;
  /** Debounce window in ms. Default 500; tests pass 0 for sync commits. */
  debounceMs?: number;
  /** Render inline −/+ steppers around the field (for roomy editor rows).
   *  Default false — compact/inline fields stay keypad-only. */
  steppers?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

/** Decimal places in a number's string form (`0.1` → 1, `5` → 0). */
const decimals = (n: number): number => {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

/**
 * Number input that maintains a local string while typing and writes the
 * parsed value through `onCommit` on a debounce. Blur flushes immediately,
 * so navigating away never strands an unsaved edit.
 *
 * Entry is via the in-app {@link NumericKeypad}, not the OS keyboard: the
 * input carries `inputmode="none"` so the soft keyboard never opens (it would
 * cover half the screen in the gateway WebView), and on focus the field
 * registers a controller with the global pad. A hardware keyboard still works
 * (desktop dev). Optional inline steppers nudge by `step` (with hold-to-repeat)
 * and clamp to `min`/`max`.
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
  let inputEl: HTMLInputElement | undefined;
  let controller: KeypadController | undefined;

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

  // ── Steppers (−/+) ─────────────────────────────────────────────────────
  const nudge = (dir: 1 | -1) => {
    const stepv = p.step ?? 1;
    const base = parse(local()) ?? p.min ?? 0;
    let next = base + dir * stepv;
    const dec = Math.max(decimals(stepv), decimals(base));
    next = Number(next.toFixed(dec));
    if (p.min !== undefined) next = Math.max(p.min, next);
    if (p.max !== undefined) next = Math.min(p.max, next);
    const s = String(next);
    setLocal(s);
    schedule(s);
  };

  // Hold-to-repeat: accelerating recursive timeout (no standing interval),
  // started on pointer-down and cleared on release.
  let repeatTimer: ReturnType<typeof setTimeout> | undefined;
  const stopRepeat = () => {
    if (repeatTimer !== undefined) {
      clearTimeout(repeatTimer);
      repeatTimer = undefined;
    }
  };
  const startRepeat = (dir: 1 | -1) => {
    nudge(dir);
    let delay = 400;
    const tick = () => {
      nudge(dir);
      delay = Math.max(60, delay - 40);
      repeatTimer = setTimeout(tick, delay);
    };
    repeatTimer = setTimeout(tick, delay);
  };

  onCleanup(() => {
    clearTimer();
    stopRepeat();
    closeKeypad(controller);
  });

  const handleFocus = () => {
    focused = true;
    controller = {
      label: p.ariaLabel,
      unit: p.unit,
      fractional: p.decimal ?? (p.step === undefined || p.step < 1),
      anchorEl: inputEl!,
      value: () => local(),
      setValue: (next) => {
        setLocal(next);
        schedule(next);
      },
      commit: () => flush(local()),
    };
    openKeypad(controller);
  };

  const handleBlur = (raw: string) => {
    focused = false;
    flush(raw);
    // Deferred + cancelable: if focus moved to another number field, that
    // field's openKeypad has already cancelled this close.
    if (controller) requestCloseKeypad(controller);
  };

  const field = (
    <input
      ref={inputEl}
      type="text"
      inputmode="none"
      class={p.class}
      style={p.style}
      value={local()}
      placeholder={p.placeholder}
      aria-label={p.ariaLabel}
      data-testid={p.testId}
      onFocus={handleFocus}
      onBlur={(e) => handleBlur(e.currentTarget.value)}
      onInput={(e) => {
        const raw = e.currentTarget.value;
        setLocal(raw);
        schedule(raw);
      }}
    />
  );

  if (!p.steppers) return field;

  return (
    <span class="numfield">
      <button
        type="button"
        class="numfield__step"
        aria-label="Decrease"
        onPointerDown={(e) => {
          e.preventDefault();
          startRepeat(-1);
        }}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        −
      </button>
      {field}
      <button
        type="button"
        class="numfield__step"
        aria-label="Increase"
        onPointerDown={(e) => {
          e.preventDefault();
          startRepeat(1);
        }}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        +
      </button>
    </span>
  );
};
