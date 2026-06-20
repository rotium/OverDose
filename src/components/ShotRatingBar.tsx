import { For, Show, type Accessor, type Component } from 'solid-js';
import { ShotRatingFace } from './ShotRatingFace';

/**
 * Enjoyment rating control. Stores a 0–100 value (de1app's `espresso_enjoyment`
 * scale) but presents it as five tier presets on a continuous bar:
 *
 *     [ 34px morphing face ]
 *          75 · Good
 *   ──●────┼────┼────┼────┼──   ← bar: tap/drag anywhere, soft-magnets to a tier
 *   😞   🙁   😐   🙂   😄        ← tier faces: one tap = exact preset
 *
 * Tap a tier face for the quick call, or drag the bar for an in-between value
 * (the bar magnets onto a preset within ±2 so the common picks are easy to
 * land). Read-only mode drops the bar + tiers and shows just the face + word.
 *
 * `null` = unrated (no thumb, neutral grey face). Distinct from `0` (rated
 * worst).
 */
export const RATING_PRESETS = [0, 25, 50, 75, 100] as const;
const RATING_WORDS = ['Bad', 'Meh', 'OK', 'Good', 'Great'];
const MAGNET = 2; // bar snaps to a preset when within ±2 of it

/** Index of the preset nearest a 0–100 value (its tier bucket). */
export const nearestRatingTier = (v: number): number => {
  let bi = 0;
  let bd = Infinity;
  RATING_PRESETS.forEach((p, i) => {
    const d = Math.abs(p - v);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return bi;
};

/** Word for a 0–100 value (its nearest tier). */
export const ratingWord = (v: number): string =>
  RATING_WORDS[nearestRatingTier(v)]!;

export const ShotRatingBar: Component<{
  value: Accessor<number | null>;
  onChange: (v: number) => void;
  editable: Accessor<boolean>;
  /** When set, the editable control carries this as its `data-testid`. */
  testId?: string;
}> = (p) => {
  let barEl: HTMLDivElement | undefined;

  // Map a pointer x to a 0–100 value, magnetting onto the nearest preset when
  // within ±MAGNET. Guards width===0 (jsdom / not yet laid out).
  const setFromClientX = (clientX: number): void => {
    if (!barEl) return;
    const r = barEl.getBoundingClientRect();
    if (r.width === 0) return;
    let raw = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    const ni = nearestRatingTier(raw);
    if (Math.abs(RATING_PRESETS[ni]! - raw) <= MAGNET) raw = RATING_PRESETS[ni]!;
    p.onChange(Math.round(raw));
  };

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }): void => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.buttons === 0) return; // only while pressed
    setFromClientX(e.clientX);
  };

  const v = (): number | null => p.value();
  const onTier = (i: number): boolean =>
    v() != null && (RATING_PRESETS as readonly number[]).includes(v()!) &&
    nearestRatingTier(v()!) === i;

  return (
    <div class="rating" data-testid={p.editable() ? p.testId : undefined}>
      <ShotRatingFace value={v()} size={34} />

      <div class="rating__caption">
        <Show
          when={v() != null}
          fallback={
            <span class="rating__hint">
              {p.editable() ? 'Tap to rate' : 'Unrated'}
            </span>
          }
        >
          <span class="rating__num">{v()}</span>
          <span class="rating__word"> · {ratingWord(v()!)}</span>
        </Show>
      </div>

      <Show when={p.editable()}>
        <div
          ref={barEl}
          class="rating__bar"
          role="slider"
          aria-label="Enjoyment rating, 0 to 100"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={v() ?? undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <div class="rating__fill" style={{ width: `${v() ?? 0}%` }} />
          <For each={RATING_PRESETS}>
            {(preset) => (
              <div class="rating__tick" style={{ left: `${preset}%` }} />
            )}
          </For>
          <Show when={v() != null}>
            <div class="rating__thumb" style={{ left: `${v()}%` }} />
          </Show>
        </div>

        <div class="rating__tiers">
          <For each={RATING_PRESETS}>
            {(preset, i) => (
              <button
                type="button"
                class="rating__tier"
                classList={{ 'rating__tier--on': onTier(i()) }}
                style={{ left: `${preset}%` }}
                aria-label={`${RATING_WORDS[i()]} (${preset})`}
                data-testid={p.testId ? `${p.testId}-tier-${i() + 1}` : undefined}
                onClick={() => p.onChange(preset)}
              >
                <ShotRatingFace value={preset} size={14} />
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
