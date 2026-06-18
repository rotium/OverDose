/**
 * In-app numeric keypad — replaces the OS soft keyboard for number entry.
 *
 * Inside the gateway WebView the Android keyboard overlays half the screen
 * (see keyboardInset.ts). For numbers we sidestep it entirely: number fields
 * set `inputmode="none"` so the OS keyboard never opens, and on focus they
 * register a {@link KeypadController} with this single, app-wide pad. The pad
 * is far smaller than the OS keyboard and we control where it sits.
 *
 * One pad is mounted once (see App.tsx). A field "owns" it while focused;
 * focusing another field hands it over; blurring to a non-field closes it.
 *
 * Positioning: on open the pad anchors just below the focused field (flipping
 * above when there's no room). The user can drag it by its handle; once moved,
 * it stays put across fields until the pad closes (sticky — design option b).
 * Double-tap the handle to re-anchor under the current field.
 */
import {
  Index,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { recentsFor, RECENTS_CAP } from './numericRecents';

export interface KeypadController {
  /** Field label, shown in the pad's handle. */
  label?: string;
  /** Unit shown beside the value in the readout (e.g. "g", "mL"). */
  unit?: string;
  /** Input mode: 'number' (default) or 'time' (HH:MM, left-to-right fill). */
  mode?: 'number' | 'time';
  /** Semantic key for the MRU quick-pick chips (e.g. "dose"); omitted = none. */
  recentsKey?: string;
  /** Whether a decimal point is allowed (false → integer field). */
  fractional: boolean;
  /** The input element — used to anchor the pad and to blur on Done. */
  anchorEl: HTMLElement;
  /** Reactive accessor for the field's current editing string. */
  value: () => string;
  /** Replace the editing string (field updates + schedules its commit). */
  setValue: (next: string) => void;
  /** Flush the pending commit immediately. */
  commit: () => void;
}

const [active, setActive] = createSignal<KeypadController | null>(null);
// A close requested by a field's blur is *deferred* and *cancelable*: if
// another field grabs the pad before the deferred close runs, the close is
// cancelled. This guarantees the pad never blips to `null` during a field
// hand-over (which would otherwise reset the "fresh open" state and make it
// re-anchor on every field).
let pendingClose: KeypadController | null = null;

/** Open (or hand over) the pad to a field. Cancels any pending blur-close. */
export const openKeypad = (c: KeypadController): void => {
  pendingClose = null;
  setActive(c);
};

/** Deferred close from a field losing focus. No-ops if another field has
 *  since taken the pad over. */
export const requestCloseKeypad = (c: KeypadController): void => {
  pendingClose = c;
  queueMicrotask(() => {
    if (pendingClose === c && active() === c) {
      pendingClose = null;
      setActive(null);
    }
  });
};

/** Immediate close (the Done button / handle ✕). */
export const closeKeypad = (c?: KeypadController): void => {
  pendingClose = null;
  if (!c || active() === c) setActive(null);
};

interface Pos {
  left: number;
  top: number;
}

const GAP = 8;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(v, hi));

/** Turn a buffer of up to 4 digits into a clamped "HH:MM" (pads right with
 *  zeros, so "11" → 11:00, "112" → 11:20; clamps 23:59). */
const formatTime = (digits: string): string => {
  const padded = (digits + '0000').slice(0, 4);
  const hh = Math.min(23, Number(padded.slice(0, 2)) || 0);
  const mm = Math.min(59, Number(padded.slice(2, 4)) || 0);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const NumericKeypad: Component = () => {
  const [pos, setPos] = createSignal<Pos>({ left: 0, top: 0 });
  // Overtype mode: when a field first gains the pad its value stays visible,
  // but the first digit/decimal *replaces* it (rather than appending to it).
  // Backspace/clear drop out of overtype so you can edit the existing value;
  // Done with no key pressed keeps it unchanged.
  const [pristine, setPristine] = createSignal(true);
  // Time mode: the 0–4 digit buffer being filled (HH then MM).
  const [timeDigits, setTimeDigits] = createSignal('');
  // We anchor to the field only on a *fresh* open. Switching fields while the
  // pad is open leaves it exactly where it is (the user found re-anchoring on
  // every field jarring); a manual drag obviously keeps its spot too. The pad
  // re-anchors below the current field on the next fresh open, or on a
  // double-tap of the handle.
  let wasOpen = false;
  let padRef: HTMLDivElement | undefined;

  const vw = (): number => window.visualViewport?.width ?? window.innerWidth;
  const vh = (): number => window.visualViewport?.height ?? window.innerHeight;

  const reposition = (c: KeypadController): void => {
    const r = c.anchorEl.getBoundingClientRect();
    const w = padRef?.offsetWidth ?? 300;
    const h = padRef?.offsetHeight ?? 320;
    let top = r.bottom + GAP;
    // Flip above the field when there isn't room below it.
    if (top + h > vh() - GAP) top = r.top - GAP - h;
    top = clamp(top, GAP, Math.max(GAP, vh() - h - GAP));
    const left = clamp(r.left, GAP, Math.max(GAP, vw() - w - GAP));
    setPos({ left, top });
  };

  // Anchor only on a fresh open (closed → open). Field hand-overs leave the
  // pad in place.
  createEffect(() => {
    const c = active();
    if (!c) {
      wasOpen = false;
      return;
    }
    setPristine(true); // each field starts in overtype mode
    setTimeDigits('');
    const fresh = !wasOpen;
    wasOpen = true;
    if (fresh) {
      // Measure after the pad has rendered so width/height are real.
      requestAnimationFrame(() => {
        if (active() === c) reposition(c);
      });
    }
  });

  const startDrag = (e: PointerEvent): void => {
    e.preventDefault();
    const start = pos();
    const offX = e.clientX - start.left;
    const offY = e.clientY - start.top;
    const move = (ev: PointerEvent): void => {
      const w = padRef?.offsetWidth ?? 300;
      const h = padRef?.offsetHeight ?? 320;
      setPos({
        left: clamp(ev.clientX - offX, GAP, Math.max(GAP, vw() - w - GAP)),
        top: clamp(ev.clientY - offY, GAP, Math.max(GAP, vh() - h - GAP)),
      });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const reanchor = (): void => {
    const c = active();
    if (!c) return;
    requestAnimationFrame(() => reposition(c));
  };

  // Keys must not steal focus from the field (would blur → close the pad, and
  // lose the caret). preventDefault on pointerdown keeps focus on the input.
  const keepFocus = (e: PointerEvent): void => e.preventDefault();

  // In time mode each digit fills the HH:MM buffer left-to-right and the
  // field's live value tracks it (clamped), so a blur commits the same thing
  // Done would.
  const setTime = (c: KeypadController, buf: string): void => {
    setTimeDigits(buf);
    c.setValue(buf === '' ? '' : formatTime(buf));
  };

  const digit = (c: KeypadController, d: string): void => {
    if (c.mode === 'time') {
      const buf = pristine() ? '' : timeDigits();
      setPristine(false);
      if (buf.length >= 4) return;
      setTime(c, buf + d);
      return;
    }
    const cur = pristine() ? '' : c.value();
    setPristine(false);
    c.setValue(cur === '0' ? d : cur + d);
  };
  const dot = (c: KeypadController): void => {
    if (c.mode === 'time' || !c.fractional) return; // ":" in time mode is inert
    const cur = pristine() ? '' : c.value();
    setPristine(false);
    if (cur.includes('.')) return;
    c.setValue(cur === '' ? '0.' : cur + '.');
  };
  const backspace = (c: KeypadController): void => {
    setPristine(false);
    if (c.mode === 'time') {
      setTime(c, timeDigits().slice(0, -1));
      return;
    }
    c.setValue(c.value().slice(0, -1));
  };
  const clearAll = (c: KeypadController): void => {
    setPristine(false);
    if (c.mode === 'time') {
      setTime(c, '');
      return;
    }
    c.setValue('');
  };
  const done = (c: KeypadController): void => {
    c.commit();
    c.anchorEl.blur();
    closeKeypad(c);
  };

  // Quick-pick: set the field to a recent value and finish (same as Done).
  const pick = (c: KeypadController, value: number): void => {
    c.setValue(String(value));
    done(c);
  };

  // Fixed-length slot list: the MRU values newest-first, padded with
  // `undefined` so every field always shows all RECENTS_CAP slots.
  const recentsSlots = (key: string): (number | undefined)[] => {
    const vals = recentsFor(key);
    return Array.from({ length: RECENTS_CAP }, (_, i) => vals[i]);
  };

  const act = (fn: (c: KeypadController) => void) => (e: MouseEvent): void => {
    e.preventDefault();
    const c = active();
    if (c) fn(c);
  };

  const Key = (props: {
    label: string;
    onPress: (c: KeypadController) => void;
    wide?: boolean;
    done?: boolean;
    /** Greyed-out but still interactive — a real `disabled` button swallows
     *  pointerdown, so focus would leave the input and the pad would close.
     *  The press handler no-ops instead. */
    dim?: boolean;
    testId?: string;
  }) => (
    <button
      type="button"
      class="numpad__key"
      classList={{
        'numpad__key--wide': props.wide,
        'numpad__key--done': props.done,
        'numpad__key--dim': props.dim,
      }}
      aria-disabled={props.dim ? 'true' : undefined}
      data-testid={props.testId}
      onPointerDown={keepFocus}
      onClick={act(props.onPress)}
    >
      {props.label}
    </button>
  );

  return (
    <Show when={active()}>
      {(c) => (
        <Portal>
          <div
            ref={padRef}
            class="numpad"
            style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
            data-testid="numeric-keypad"
          >
            <div
              class="numpad__handle"
              onPointerDown={startDrag}
              onDblClick={reanchor}
            >
              <span class="numpad__label">{c().label ?? 'Value'}</span>
              <span class="numpad__readout" data-testid="numpad-readout">
                <Show
                  when={c().mode === 'time'}
                  fallback={
                    <>
                      {c().value() || '0'}
                      <Show when={c().unit}>
                        <span class="numpad__unit"> {c().unit}</span>
                      </Show>
                    </>
                  }
                >
                  <Show
                    when={timeDigits().length > 0}
                    fallback={<span>{c().value() || '--:--'}</span>}
                  >
                    <span
                      classList={{
                        'numpad__seg--active': timeDigits().length < 2,
                      }}
                    >
                      {(timeDigits().slice(0, 2) + '__').slice(0, 2)}
                    </span>
                    <span>:</span>
                    <span
                      classList={{
                        'numpad__seg--active': timeDigits().length >= 2,
                      }}
                    >
                      {(timeDigits().slice(2, 4) + '__').slice(0, 2)}
                    </span>
                  </Show>
                </Show>
              </span>
              <button
                type="button"
                class="numpad__close"
                aria-label="Done"
                onPointerDown={keepFocus}
                onClick={act(done)}
              >
                ✕
              </button>
            </div>
            <div class="numpad__body">
              <Show when={c().mode !== 'time' && c().recentsKey}>
                <div class="numpad__recents" data-testid="numpad-recents">
                  <Index each={recentsSlots(c().recentsKey!)}>
                    {(slot) => (
                      <Show
                        when={slot() !== undefined}
                        fallback={
                          <span
                            class="numpad__recent numpad__recent--empty"
                            aria-hidden="true"
                            onPointerDown={keepFocus}
                          />
                        }
                      >
                        <button
                          type="button"
                          class="numpad__recent"
                          onPointerDown={keepFocus}
                          onClick={act((cc) => pick(cc, slot()!))}
                        >
                          {slot()}
                        </button>
                      </Show>
                    )}
                  </Index>
                </div>
              </Show>
              <div class="numpad__grid">
              <Key label="7" onPress={(c) => digit(c, '7')} />
              <Key label="8" onPress={(c) => digit(c, '8')} />
              <Key label="9" onPress={(c) => digit(c, '9')} />
              <Key label="⌫" onPress={backspace} testId="numpad-backspace" />
              <Key label="4" onPress={(c) => digit(c, '4')} />
              <Key label="5" onPress={(c) => digit(c, '5')} />
              <Key label="6" onPress={(c) => digit(c, '6')} />
              <Key label="C" onPress={clearAll} testId="numpad-clear" />
              <Key label="1" onPress={(c) => digit(c, '1')} />
              <Key label="2" onPress={(c) => digit(c, '2')} />
              <Key label="3" onPress={(c) => digit(c, '3')} />
              <Key
                label={c().mode === 'time' ? ':' : '.'}
                onPress={dot}
                dim={c().mode === 'time' || !c().fractional}
                testId="numpad-dot"
              />
              <Key label="0" onPress={(c) => digit(c, '0')} wide />
              <Key label="Done" onPress={done} wide done testId="numpad-done" />
              </div>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  );
};

export interface TimeFieldProps {
  /** "HH:MM" (or empty). */
  value: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  testId?: string;
  class?: string;
}

/**
 * A read-only "HH:MM" field driven by the keypad's time mode — tapping it
 * opens the pad, which fills HH then auto-advances to MM. Mirrors
 * DebouncedNumberField's focus/blur/hand-over plumbing; no OS keyboard.
 */
export const TimeField: Component<TimeFieldProps> = (p) => {
  const [local, setLocal] = createSignal(p.value);
  let focused = false;
  let inputEl: HTMLInputElement | undefined;
  let controller: KeypadController | undefined;

  createEffect(() => {
    const v = p.value;
    if (!focused) setLocal(v);
  });

  onCleanup(() => closeKeypad(controller));

  const handleFocus = (): void => {
    focused = true;
    controller = {
      label: p.ariaLabel,
      mode: 'time',
      fractional: false,
      anchorEl: inputEl!,
      value: () => local(),
      setValue: (s) => setLocal(s),
      commit: () => p.onCommit(local()),
    };
    openKeypad(controller);
  };

  const handleBlur = (): void => {
    focused = false;
    p.onCommit(local());
    if (controller) requestCloseKeypad(controller);
  };

  return (
    <input
      ref={inputEl}
      type="text"
      inputmode="none"
      readonly
      class={p.class}
      value={local()}
      placeholder={p.placeholder}
      aria-label={p.ariaLabel}
      data-testid={p.testId}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
};
