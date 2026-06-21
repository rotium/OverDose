import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';

export interface AutocompleteInputProps {
  value: string;
  suggestions: string[];
  /** Fires on every keystroke and on selection (for live-bound drafts). */
  onInput?: (value: string) => void;
  /** Fires on blur and on selection (commit-on-blur, like a plain field). */
  onChange?: (value: string) => void;
  /** Escape with the list already closed (e.g. to cancel a create form). */
  onEscape?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
  /** Class for the inner <input>. */
  class?: string;
  /** Class for the positioning wrapper (e.g. flex sizing in a row form). */
  wrapperClass?: string;
  inputRef?: (el: HTMLInputElement) => void;
}

/**
 * Text input with a self-rendered suggestion dropdown. Replaces native
 * `<datalist>`, whose popup the browser positions for us — unreliable inside
 * transformed / scrollable containers (the side-sheet) and in device-mode
 * emulation, and visually inconsistent with the app. This dropdown is a plain
 * absolutely-positioned element anchored to a relative wrapper, so it's always
 * the field's width and directly beneath it.
 */
export const AutocompleteInput: Component<AutocompleteInputProps> = (p) => {
  const [text, setText] = createSignal(p.value);
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(-1);
  // Flip the suggestion list above the input when there isn't room below it —
  // e.g. the soft keyboard covering the lower half — so the list stays visible.
  const [dropUp, setDropUp] = createSignal(false);
  let focused = false;
  let blurTimer: number | undefined;
  let dirTimer: number | undefined;
  let wrapEl: HTMLSpanElement | undefined;

  /** Choose drop direction from the space below the input within the visible
   *  viewport (visualViewport shrinks when the keyboard is open). Drop up only
   *  when below is too tight AND there's more room above. */
  const measureDir = (): void => {
    const input = wrapEl?.querySelector('input');
    if (!input) return;
    const r = input.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = vv?.offsetTop ?? 0;
    const bottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight);
    const NEEDED_PX = 200; // ~5 options + padding
    const below = bottom - r.bottom;
    const above = r.top - top;
    setDropUp(below < NEEDED_PX && above > below);
  };

  /** Measure now, next frame, and after the keyboard settles (it animates in
   *  after focus, and the WebView doesn't fire a resize for it). */
  const scheduleMeasure = (): void => {
    measureDir();
    requestAnimationFrame(measureDir);
    if (dirTimer !== undefined) clearTimeout(dirTimer);
    dirTimer = window.setTimeout(measureDir, 350);
  };

  // Snap to an external value change (e.g. a refetch) only while unfocused, so
  // a save round-trip mid-type doesn't clobber what's being written.
  createEffect(() => {
    const v = p.value;
    if (!focused) setText(v);
  });

  const matches = createMemo(() => {
    const q = text().trim().toLowerCase();
    const all = p.suggestions ?? [];
    const filtered =
      q === '' ? all : all.filter((s) => s.toLowerCase().includes(q));
    // Nothing useful to offer once the text already equals a suggestion.
    return filtered.filter((s) => s.toLowerCase() !== q).slice(0, 8);
  });

  const showList = () => open() && matches().length > 0;

  const select = (s: string) => {
    setText(s);
    p.onInput?.(s);
    p.onChange?.(s);
    setOpen(false);
    setHighlight(-1);
  };

  onCleanup(() => {
    if (blurTimer !== undefined) clearTimeout(blurTimer);
    if (dirTimer !== undefined) clearTimeout(dirTimer);
  });

  return (
    <span ref={wrapEl} class={`autocomplete ${p.wrapperClass ?? ''}`}>
      <input
        ref={p.inputRef}
        type="text"
        class={p.class}
        value={text()}
        placeholder={p.placeholder}
        aria-label={p.ariaLabel}
        data-testid={p.testId}
        role="combobox"
        aria-expanded={showList()}
        autocomplete="off"
        onFocus={() => {
          focused = true;
          setOpen(true);
          scheduleMeasure();
        }}
        onBlur={() => {
          focused = false;
          // Defer so a mousedown on an option still registers as a select.
          blurTimer = window.setTimeout(() => {
            setOpen(false);
            p.onChange?.(text());
          }, 120);
        }}
        onInput={(e) => {
          setText(e.currentTarget.value);
          p.onInput?.(e.currentTarget.value);
          setOpen(true);
          setHighlight(-1);
          measureDir();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, matches().length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (showList() && highlight() >= 0) {
              e.preventDefault();
              select(matches()[highlight()]);
            }
          } else if (e.key === 'Escape') {
            if (open()) {
              setOpen(false);
              setHighlight(-1);
            } else {
              p.onEscape?.();
            }
          }
        }}
      />
      <Show when={showList()}>
        <ul
          class="autocomplete__list"
          classList={{ 'autocomplete__list--up': dropUp() }}
          role="listbox"
          data-testid={p.testId ? `${p.testId}-list` : undefined}
        >
          <For each={matches()}>
            {(s, i) => (
              <li
                role="option"
                aria-selected={highlight() === i()}
                class="autocomplete__option"
                classList={{
                  'autocomplete__option--active': highlight() === i(),
                }}
                data-testid={p.testId ? `${p.testId}-option-${i()}` : undefined}
                onMouseDown={(e) => {
                  // mousedown (not click) fires before the input's blur.
                  e.preventDefault();
                  select(s);
                }}
                onMouseEnter={() => setHighlight(i())}
              >
                {s}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </span>
  );
};
