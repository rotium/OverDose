import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';

/**
 * Centered modal dialog used by pickers (profile, future bean/grinder).
 *
 * Distinct from the side-sheet pattern that BeveragesSection / RecipesSection
 * use for editors — a side sheet is for "go deep into editing one thing",
 * a picker dialog is for "make a quick choice and return". Centered modal
 * keeps the parent editor's spatial context visible behind a dimmed
 * backdrop, and the dialog itself stays compact instead of taking 70% of
 * the canvas.
 *
 * **Always rendered via Portal at document.body.** Otherwise the side-sheet
 * animation (which leaves `transform: translateX(0)` applied via
 * `animation-fill-mode: forwards`) creates a containing block for any
 * fixed-positioned descendants. The dialog's `position: fixed; inset: 0`
 * would then be relative to the side-sheet instead of the viewport — the
 * backdrop would only cover the sheet area, and clicks outside the sheet
 * would fall through to the side-sheet's own backdrop and close the editor.
 *
 * Close affordances: explicit close button, Escape key, optional backdrop
 * click (`dismissibleOnBackdrop`, default false for committing pickers).
 * The same `animatingOut` flip + setTimeout cleanup pattern drives the
 * slide-out so we don't unmount mid-animation.
 */

export interface PickerDialogProps {
  /** Drives mount + open/close animation. */
  open: boolean;
  /** Called when the user closes via the close button, Escape, or
   *  backdrop (only when `dismissibleOnBackdrop` is true). */
  onClose: () => void;
  /** Title rendered in the dialog header. */
  title: string;
  /** Optional descriptive text shown under the title. */
  description?: string;
  /** Optional footer slot (Cancel / Choose buttons live here when the
   *  picker is in select mode). */
  footer?: JSX.Element;
  /** data-testid root override. */
  testId?: string;
  /** Optional max-width override. Defaults to ~720px for simple pickers;
   *  master-detail pickers pass a wider value. */
  maxWidthPx?: number;
  /** When true, clicking the backdrop calls `onClose`. Defaults to
   *  `false` — pickers used for committing a choice (Recipe profile,
   *  future Bean/Grinder) require an explicit Cancel / × so a stray
   *  click never throws away the user's preview-in-progress. The
   *  parent stays explicitly modal. */
  dismissibleOnBackdrop?: boolean;
  children?: JSX.Element;
}

const ANIM_MS = 200;

export const PickerDialog: Component<PickerDialogProps> = (p) => {
  const [visible, setVisible] = createSignal(false);
  const [animatingOut, setAnimatingOut] = createSignal(false);
  let exitTimer: number | undefined;

  const beginClose = () => {
    if (!visible()) return;
    setAnimatingOut(true);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    exitTimer = window.setTimeout(() => {
      setVisible(false);
      setAnimatingOut(false);
      exitTimer = undefined;
    }, ANIM_MS);
  };

  // Drive visibility from the `open` prop. Going open → closed plays the
  // slide-out; going closed → open clears any pending close timer.
  createEffect(() => {
    if (p.open) {
      if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
        exitTimer = undefined;
      }
      setAnimatingOut(false);
      setVisible(true);
    } else {
      beginClose();
    }
  });

  // Escape closes — only when the dialog is mounted, so parent dialogs
  // in a stack would each handle their own. Registered in CAPTURE phase
  // so the topmost open dialog runs first, and `stopImmediatePropagation`
  // prevents other window-level Escape handlers (e.g. the parent side-
  // sheet's close-on-Escape) from also firing. Without this the Escape
  // press would close both the picker and the editor that opened it.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && p.open) {
      e.preventDefault();
      e.stopImmediatePropagation();
      p.onClose();
    }
  };
  window.addEventListener('keydown', onKey, true);
  onCleanup(() => {
    window.removeEventListener('keydown', onKey, true);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
  });

  const handleBackdropClick = (e: MouseEvent) => {
    // Only treat clicks on the backdrop itself — clicks bubbling up from
    // inside the dialog have a different currentTarget chain.
    if (e.target !== e.currentTarget) return;
    // Defensive: stop propagation regardless of whether we close, so the
    // side-sheet backdrop underneath (z-index 10 vs our 20) can't catch
    // the click even on layouts where the DOM hierarchy makes it visible.
    e.stopPropagation();
    if (p.dismissibleOnBackdrop) p.onClose();
  };

  const testId = (): string => p.testId ?? 'picker-dialog';

  return (
    <Show when={visible()}>
      <Portal>
        <div
          class="picker-dialog__backdrop"
          data-state={animatingOut() ? 'closing' : 'open'}
          data-testid={`${testId()}-backdrop`}
          onClick={handleBackdropClick}
        >
        <div
          class="picker-dialog"
          data-state={animatingOut() ? 'closing' : 'open'}
          data-testid={testId()}
          role="dialog"
          aria-modal="true"
          aria-label={p.title}
          style={p.maxWidthPx ? { 'max-width': `${p.maxWidthPx}px` } : undefined}
        >
          <header class="picker-dialog__header">
            <div class="picker-dialog__heading">
              <h2 class="picker-dialog__title">{p.title}</h2>
              <Show when={p.description}>
                <p class="picker-dialog__description">{p.description}</p>
              </Show>
            </div>
            <button
              type="button"
              class="picker-dialog__close"
              aria-label="Close dialog"
              data-testid={`${testId()}-close`}
              onClick={p.onClose}
            >
              ×
            </button>
          </header>
          <div class="picker-dialog__body">{p.children}</div>
          <Show when={p.footer}>
            <footer
              class="picker-dialog__footer"
              data-testid={`${testId()}-footer`}
            >
              {p.footer}
            </footer>
          </Show>
        </div>
        </div>
      </Portal>
    </Show>
  );
};
