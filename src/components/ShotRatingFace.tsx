import { type Component } from 'solid-js';

/**
 * A drawn face whose expression tracks a 0–100 enjoyment value — the
 * value-indicator beside the post-brew rating slider. The mouth curve
 * interpolates frown→smile and the stroke shifts from a muted amber to the
 * "good" green as the value rises. No word label: the rating is overall
 * *enjoyment*, not a single taste axis, so the face + the numeric read-back
 * carry it and the Notes field captures the "why". `null` reads as an
 * un-rated, neutral face.
 *
 * Drawn rather than an emoji so it renders identically on the Decent
 * tablet and themes with the rest of the skin. Re-renders per slider tick
 * (cheap), which makes the morph track the thumb without animating `d`.
 */

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export const ShotRatingFace: Component<{
  value: number | null;
  size?: number;
}> = (p) => {
  const has = (): boolean => p.value != null;
  const t = (): number => clamp01((p.value ?? 50) / 100);

  // Mouth: endpoints fixed; the control-point Y sweeps below the line
  // (smile, value high) to above it (frown, value low). At t=0.5 it's flat.
  const ctrlY = (): number => 40 + (t() - 0.5) * 26;
  // Amber (h≈28) → green (h≈140). Muted grey when un-rated.
  const stroke = (): string =>
    has() ? `hsl(${28 + t() * 112} 68% 52%)` : 'var(--muted, #8a8a8a)';

  const size = (): number => p.size ?? 72;

  return (
    <div class="rating-face" data-testid="rating-face">
      <svg
        class="rating-face__svg"
        width={size()}
        height={size()}
        viewBox="0 0 64 64"
        aria-hidden="true"
        style={{ color: stroke() }}
      >
        <circle
          class="rating-face__disc"
          cx="32"
          cy="32"
          r="29"
          fill="currentColor"
          fill-opacity="0.12"
          stroke="currentColor"
          stroke-width="2"
        />
        <circle cx="24" cy="26" r="2.6" fill="currentColor" />
        <circle cx="40" cy="26" r="2.6" fill="currentColor" />
        <path
          class="rating-face__mouth"
          d={`M 22 40 Q 32 ${ctrlY()} 42 40`}
          fill="none"
          stroke="currentColor"
          stroke-width="3.2"
          stroke-linecap="round"
        />
      </svg>
    </div>
  );
};
