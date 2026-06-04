import { describe, expect, it, vi } from 'vitest';
import type uPlot from 'uplot';
import { drawStepBoundaries } from './LiveShotChart';
import type { LiveShotBuffers } from '../liveShot';

/** Minimal LiveShotBuffers stub — only the fields drawStepBoundaries reads. */
const buffers = (
  profileFrame: number[],
  tMs: number[],
): LiveShotBuffers =>
  ({
    cursor: profileFrame.length,
    profileFrame: Int32Array.from(profileFrame),
    tMs: Float64Array.from(tMs),
    // unused by the boundary drawer
    pressure: new Float64Array(),
    flow: new Float64Array(),
    weightFlow: new Float64Array(),
    weight: new Float64Array(),
    mixTemperature: new Float64Array(),
    targetPressure: new Float64Array(),
    targetFlow: new Float64Array(),
    targetMixTemperature: new Float64Array(),
  }) as unknown as LiveShotBuffers;

/** Fake uPlot with a recording 2D context. */
const fakeU = () => {
  const calls = { stroke: 0, fillText: [] as string[] };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => calls.stroke++),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 30 })),
    fillText: vi.fn((s: string) => calls.fillText.push(s)),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: '',
    textAlign: '',
  };
  const u = {
    ctx,
    bbox: { top: 10, left: 20, width: 300, height: 200 },
    valToPos: (v: number) => v * 10, // seconds → px, monotonic
  } as unknown as uPlot;
  return { u, calls };
};

describe('drawStepBoundaries', () => {
  it('draws one line per profileFrame transition', () => {
    // frames 0,0,1,1,2 → two transitions (0→1 at i=2, 1→2 at i=4)
    const b = buffers([0, 0, 1, 1, 2], [0, 100, 200, 300, 400]);
    const { u, calls } = fakeU();
    drawStepBoundaries(u, b, {
      title: 't',
      steps: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    });
    expect(calls.stroke).toBe(2);
    // labels use the *destination* step name
    expect(calls.fillText).toEqual(['b', 'c']);
  });

  it('draws a single line for one transition (the sim-shot case)', () => {
    // The MockDe1 espresso path commonly only reaches frame 1 before the
    // shot ends — exactly one boundary should still be drawn.
    const b = buffers([0, 0, 0, 1, 1], [0, 100, 200, 300, 400]);
    const { u, calls } = fakeU();
    drawStepBoundaries(u, b, { title: 't', steps: [{ name: 'a' }, { name: 'b' }] });
    expect(calls.stroke).toBe(1);
  });

  it('still draws the line when no profile / step name is available', () => {
    const b = buffers([0, 1], [0, 100]);
    const { u, calls } = fakeU();
    drawStepBoundaries(u, b, null);
    expect(calls.stroke).toBe(1);
    expect(calls.fillText).toEqual([]); // no label, but the line is there
  });

  it('does nothing with fewer than two samples', () => {
    const b = buffers([0], [0]);
    const { u, calls } = fakeU();
    drawStepBoundaries(u, b, null);
    expect(calls.stroke).toBe(0);
  });
});
