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
  Show,
  createEffect,
  createSignal,
  type Component,
} from 'solid-js';
import { Portal } from 'solid-js/web';

export interface KeypadController {
  /** Field label, shown in the pad's handle. */
  label?: string;
  /** Unit shown beside the value in the readout (e.g. "g", "mL"). */
  unit?: string;
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

/** Open (or hand over) the pad to a field. */
export const openKeypad = (c: KeypadController): void => {
  setActive(c);
};

/** Close the pad. With a controller, only closes if that field still owns it
 *  — so a blur that's immediately followed by another field's focus is a
 *  no-op (the new field already took ownership). */
export const closeKeypad = (c?: KeypadController): void => {
  if (!c || active() === c) setActive(null);
};

interface Pos {
  left: number;
  top: number;
}

const GAP = 8;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(v, hi));

export const NumericKeypad: Component = () => {
  const [pos, setPos] = createSignal<Pos>({ left: 0, top: 0 });
  // Overtype mode: when a field first gains the pad its value stays visible,
  // but the first digit/decimal *replaces* it (rather than appending to it).
  // Backspace/clear drop out of overtype so you can edit the existing value;
  // Done with no key pressed keeps it unchanged.
  const [pristine, setPristine] = createSignal(true);
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

  const digit = (c: KeypadController, d: string): void => {
    const cur = pristine() ? '' : c.value();
    setPristine(false);
    c.setValue(cur === '0' ? d : cur + d);
  };
  const dot = (c: KeypadController): void => {
    if (!c.fractional) return;
    const cur = pristine() ? '' : c.value();
    setPristine(false);
    if (cur.includes('.')) return;
    c.setValue(cur === '' ? '0.' : cur + '.');
  };
  const backspace = (c: KeypadController): void => {
    setPristine(false);
    c.setValue(c.value().slice(0, -1));
  };
  const clearAll = (c: KeypadController): void => {
    setPristine(false);
    c.setValue('');
  };
  const done = (c: KeypadController): void => {
    c.commit();
    c.anchorEl.blur();
    closeKeypad(c);
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
                {c().value() || '0'}
                <Show when={c().unit}>
                  <span class="numpad__unit"> {c().unit}</span>
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
                label="."
                onPress={dot}
                dim={!c().fractional}
                testId="numpad-dot"
              />
              <Key label="0" onPress={(c) => digit(c, '0')} wide />
              <Key label="Done" onPress={done} wide done testId="numpad-done" />
            </div>
          </div>
        </Portal>
      )}
    </Show>
  );
};
