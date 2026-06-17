/**
 * Shared rendering for the profile step-boundary annotations (dashed divider
 * line + step-name chip) drawn in the uPlot `draw` hook. Used by both the live
 * chart (`LiveShotChart`) during a brew and the frozen-shot chart
 * (`ShotMiniChart`) in review, so the look stays identical across them.
 *
 * The chips mirror the on-chart value flags: a faint ghost chip with haloed
 * light text by default, and a filled neutral "selected pill" with dark text
 * for the active step (the current step live; the crosshair's step in review).
 *
 * These hooks draw in *device* pixels (like uPlot's own axis labels), so font
 * and chip metrics are scaled by the device pixel ratio — otherwise text
 * renders half-size on a HiDPI tablet.
 */

/** Plot-area overshoot for the divider line, top and bottom. */
export const STEP_OVERSHOOT = 16;

const LINE = 'rgba(255, 255, 255, 0.5)';
const CHIP_BG = 'rgba(10, 10, 10, 0.35)';
const CHIP_FG = 'rgba(235, 235, 235, 0.7)';
const CHIP_HALO = '#000';
const CHIP_ACTIVE_BG = 'rgba(225, 227, 230, 0.82)';
const CHIP_ACTIVE_FG = '#0a0a0a';

/** Filled rounded rect, falling back to a square fill where `roundRect` is
 *  unavailable (e.g. the jsdom canvas stub / fakes in tests). */
const fillRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void => {
  ctx.fillStyle = fill;
  const rr = (
    ctx as unknown as {
      roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
    }
  ).roundRect;
  if (typeof rr === 'function') {
    ctx.beginPath();
    rr.call(ctx, x, y, w, h, r);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
};

/** The chips' text size in device px — matches the value flags' 0.85rem.
 *  `rem` resolves unreliably inside canvas, so derive it from the root size. */
export const stepLabelFontPx = (dpr: number): number => {
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return Math.round(rootPx * 0.85 * dpr);
};

/** Apply the shared step-label font (bold, flag-matching) to the context. */
export const setStepLabelFont = (ctx: CanvasRenderingContext2D, fontPx: number): void => {
  ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
};

/** The dashed neutral divider line at a boundary's x. */
export const drawStepLine = (
  ctx: CanvasRenderingContext2D,
  xPos: number,
  top: number,
  bottom: number,
): void => {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(xPos, top);
  ctx.lineTo(xPos, bottom);
  ctx.stroke();
};

/** One step-name chip near the top of the plot, just right of `xPos` (clamped
 *  to `plotRight`). Caller must have set the font via {@link setStepLabelFont}. */
export const drawStepChip = (
  ctx: CanvasRenderingContext2D,
  xPos: number,
  top: number,
  plotRight: number,
  name: string,
  fontPx: number,
  dpr: number,
  active: boolean,
): void => {
  ctx.setLineDash([]);
  const padX = 2 * dpr;
  const padY = 1 * dpr;
  const labelW = ctx.measureText(name).width;
  const labelH = fontPx;
  const finalX = Math.min(xPos + 4 * dpr, plotRight - labelW - padX * 2 - dpr);
  const labelY = top + 4 * dpr;
  fillRoundRect(
    ctx,
    finalX - padX,
    labelY - padY,
    labelW + padX * 2,
    labelH + padY * 2,
    4 * dpr,
    active ? CHIP_ACTIVE_BG : CHIP_BG,
  );
  ctx.fillStyle = active ? CHIP_ACTIVE_FG : CHIP_FG;
  if (!active) {
    ctx.shadowColor = CHIP_HALO;
    ctx.shadowBlur = 3 * dpr;
  }
  ctx.textAlign = 'left';
  ctx.fillText(name, finalX, labelY);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
};
