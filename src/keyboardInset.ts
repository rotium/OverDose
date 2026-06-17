/**
 * Keyboard-aware viewport controller.
 *
 * We run inside the Decent gateway's Android WebView (immersive/fullscreen).
 * The soft keyboard *overlays* the WebView rather than resizing it, so a
 * `100vh` layout stays full-height and the bottom half — including whatever
 * field is focused — ends up hidden behind the keyboard.
 *
 * `window.visualViewport` is the only signal that reflects the keyboard in
 * this overlay mode. We translate it into two CSS custom properties on
 * `<html>` that the fixed-size surfaces consume:
 *
 *   --app-height     the height still visible above the keyboard
 *                    (full viewport height when no keyboard)
 *   --keyboard-inset how many px the keyboard covers from the bottom
 *                    (0 when no keyboard)
 *
 * and toggles `data-keyboard-open` on `<html>` for any open/closed styling.
 *
 * The catch: in this WebView the `visualViewport` `resize` event does NOT
 * fire reliably when the keyboard *opens* — it often only fires on a later
 * re-layout (e.g. the first keystroke). So we can't lean on the event alone
 * to reveal the focused field. Instead, on focus we run a short bounded
 * animation-frame poll that re-measures `visualViewport` directly and
 * scrolls the field into the visible band the moment the keyboard settles.
 * The poll is self-terminating (capped duration, stops on blur) — not a
 * standing interval.
 *
 * Defaults live in CSS (`--app-height: 100vh; --keyboard-inset: 0px`), so if
 * `visualViewport` is unavailable this controller no-ops and the layout
 * behaves exactly as before.
 */

/** Below this many covered px we treat the keyboard as closed (toolbars etc). */
const KEYBOARD_OPEN_THRESHOLD_PX = 80;
/** How long to keep re-measuring after focus, waiting for the keyboard. */
const FOCUS_WATCH_MS = 1500;
/** Leave a little breathing room below the field when checking visibility. */
const VISIBLE_MARGIN_PX = 12;

const isEditable = (el: EventTarget | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    // Buttons/checkboxes/etc. don't summon a keyboard.
    const type = (el as HTMLInputElement).type;
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color'].includes(
      type,
    );
  }
  return false;
};

export function initKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;

  const root = document.documentElement;
  let focusedEditable: HTMLElement | null = null;
  let watchUntil = 0;
  let watching = false;

  /** Publish the current viewport state to CSS. Returns whether the keyboard
   *  looks open. */
  const measure = (): boolean => {
    const inset = Math.max(0, root.clientHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
    root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
    const open = inset > KEYBOARD_OPEN_THRESHOLD_PX;
    if (open) root.dataset.keyboardOpen = '';
    else delete root.dataset.keyboardOpen;
    return open;
  };

  /** True when the focused field sits fully within the band above the
   *  keyboard. Instant scroll only happens when it doesn't. */
  const focusedFieldVisible = (): boolean => {
    if (!focusedEditable) return true;
    const rect = focusedEditable.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= vv.height - VISIBLE_MARGIN_PX;
  };

  const revealFocused = () => {
    if (focusedEditable && !focusedFieldVisible()) {
      // 'auto' = instant: no animation to be interrupted by the keyboard's
      // own open animation, so the field lands and stays put.
      focusedEditable.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  };

  // Bounded poll: re-measures every frame after focus until the watch window
  // expires or the field is blurred. This is what catches the keyboard even
  // when no `resize` event fires on open.
  const tick = () => {
    if (!focusedEditable || performance.now() > watchUntil) {
      watching = false;
      return;
    }
    if (measure()) revealFocused();
    requestAnimationFrame(tick);
  };

  const startWatch = () => {
    watchUntil = performance.now() + FOCUS_WATCH_MS;
    if (!watching) {
      watching = true;
      requestAnimationFrame(tick);
    }
  };

  vv.addEventListener('resize', () => {
    measure();
    revealFocused();
  });
  vv.addEventListener('scroll', measure);

  document.addEventListener('focusin', (e) => {
    if (!isEditable(e.target)) {
      focusedEditable = null;
      return;
    }
    focusedEditable = e.target;
    startWatch();
  });

  document.addEventListener('focusout', () => {
    focusedEditable = null;
  });

  measure();
}
