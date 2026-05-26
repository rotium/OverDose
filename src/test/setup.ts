import '@testing-library/jest-dom/vitest';
import { cleanup } from '@solidjs/testing-library';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom lacks these APIs that uPlot reads at import-time.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

// jsdom doesn't implement canvas 2D rendering. uPlot draws on mount + on
// setData, so any test that mounts a populated chart (ShotMiniChart with
// measurements, the live chart, the post-brew result) would otherwise
// throw "getContext() not implemented" / "clearRect of null". Stub a
// no-op 2D context so uPlot's draw calls are harmless in tests.
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {};
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
  ) {
    return {
      canvas: this,
      clearRect: noop,
      fillRect: noop,
      strokeRect: noop,
      beginPath: noop,
      closePath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      fill: noop,
      save: noop,
      restore: noop,
      translate: noop,
      scale: noop,
      rotate: noop,
      setTransform: noop,
      transform: noop,
      rect: noop,
      clip: noop,
      arc: noop,
      arcTo: noop,
      bezierCurveTo: noop,
      quadraticCurveTo: noop,
      setLineDash: noop,
      getLineDash: () => [],
      createLinearGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 0 }),
      fillText: noop,
      strokeText: noop,
      drawImage: noop,
      putImageData: noop,
      getImageData: () => ({ data: [] }),
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: '',
      lineJoin: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// uPlot builds line paths with Path2D, which jsdom doesn't define.
if (typeof globalThis.Path2D === 'undefined') {
  const noop = () => {};
  globalThis.Path2D = class {
    moveTo = noop;
    lineTo = noop;
    arc = noop;
    arcTo = noop;
    rect = noop;
    closePath = noop;
    bezierCurveTo = noop;
    quadraticCurveTo = noop;
    ellipse = noop;
    addPath = noop;
  } as unknown as typeof Path2D;
}
