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
 * On top of that, when an editable element gains focus we scroll it to the
 * centre of the (now-shrunk) visible band, so the field itself is never left
 * behind the keyboard.
 *
 * Defaults live in CSS (`--app-height: 100vh; --keyboard-inset: 0px`), so if
 * `visualViewport` is unavailable this controller no-ops and the layout
 * behaves exactly as before.
 */

/** Below this many covered px we treat the keyboard as closed (toolbars etc). */
const KEYBOARD_OPEN_THRESHOLD_PX = 80;

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
  let frame = 0;
  let focusedEditable: HTMLElement | null = null;

  const apply = () => {
    frame = 0;
    const layoutHeight = root.clientHeight;
    const inset = Math.max(0, layoutHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
    root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
    const open = inset > KEYBOARD_OPEN_THRESHOLD_PX;
    if (open) root.dataset.keyboardOpen = '';
    else delete root.dataset.keyboardOpen;

    // Keep the focused field centred in the band that survived the keyboard.
    if (open && focusedEditable) {
      focusedEditable.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);

  document.addEventListener('focusin', (e) => {
    if (!isEditable(e.target)) {
      focusedEditable = null;
      return;
    }
    focusedEditable = e.target;
    // The keyboard animates in after focus; recompute once it has, and fall
    // back to a timer in case no resize fires.
    schedule();
    setTimeout(schedule, 300);
  });

  document.addEventListener('focusout', () => {
    focusedEditable = null;
  });

  apply();
}
