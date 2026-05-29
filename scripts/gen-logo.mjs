// One-off generator: bakes the chosen P1 portafilter mark (whose grounds
// stipple is JS-scattered) into static SVG, and writes:
//   - public/favicon.svg            (simplified, legible at 16px)
//   - src/components/Logo.tsx       (detailed, for the header lockup)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const C = {
  warm: '#c98a4b',
  warmDark: '#a86f38',
  grounds: '#2a1c0e',
  groundsT: 'rgba(42,28,14,.5)',
  muted: '#888',
  elev: '#1c1c1c',
};

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function stipple(cx, cy, rx, ry, n, seed, color) {
  const r = rng(seed); let out = '';
  for (let i = 0; i < n; i++) {
    const a = r() * 2 * Math.PI, rr = Math.sqrt(r());
    const x = (cx + rx * rr * Math.cos(a)).toFixed(2);
    const y = (cy + ry * rr * Math.sin(a)).toFixed(2);
    out += `<circle cx="${x}" cy="${y}" r="${(0.5 + r() * 0.55).toFixed(2)}" fill="${color}"/>`;
  }
  return out;
}
function fullBean(cx, cy, rx, ry, rot, fill = C.grounds, crease = C.warm) {
  const bx = rx * 1.16, cyo = ry * 0.42;
  const body =
    `M${cx} ${cy - ry} C${cx + bx} ${cy - cyo} ${cx + bx} ${cy + cyo} ${cx} ${cy + ry} `
    + `C${cx - bx} ${cy + cyo} ${cx - bx} ${cy - cyo} ${cx} ${cy - ry} Z`;
  const groove =
    `M${cx} ${cy - ry + 1.3} C${cx + rx * 0.62} ${cy - ry * 0.32} ${cx - rx * 0.62} ${cy + ry * 0.32} ${cx} ${cy + ry - 1.3}`;
  const sheen =
    `M${cx - rx * 0.42} ${cy - ry * 0.45} Q${cx - bx * 0.82} ${cy} ${cx - rx * 0.42} ${cy + ry * 0.45}`;
  return `<g transform="rotate(${rot} ${cx} ${cy})">`
    + `<path d="${body}" fill="${fill}"/>`
    + `<path d="${groove}" fill="none" stroke="${crease}" stroke-width="${(rx * 0.32).toFixed(2)}" stroke-linecap="round"/>`
    + `<path d="${sheen}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="0.9" stroke-linecap="round"/></g>`;
}

// --- P1 (the winner), detailed ---------------------------------------------
const detailed =
  `<line x1="33" y1="28" x2="44.5" y2="28.5" stroke="${C.muted}" stroke-width="4.5" stroke-linecap="round"/>`
  + `<circle cx="45.5" cy="28.6" r="2.4" fill="${C.muted}"/>`
  + `<path d="M7 27 Q8 36 14 38 H26 Q32 36 33 27 Z" fill="${C.elev}" stroke="${C.muted}" stroke-width="2"/>`
  + `<ellipse cx="20" cy="27" rx="13" ry="4.2" fill="${C.elev}" stroke="${C.muted}" stroke-width="2"/>`
  + `<path d="M8 27 Q20 5 32 27 Z" fill="${C.warm}"/>`
  + stipple(20, 21, 10.5, 8, 54, 41, C.warmDark)
  + stipple(20, 16, 8, 6.5, 24, 13, C.groundsT)
  + fullBean(23, 18, 5, 6.6, 18);

// --- P1 simplified for the favicon (bold specks, no fine stipple) ----------
const simple =
  `<line x1="33" y1="28" x2="44.5" y2="28.5" stroke="${C.muted}" stroke-width="5" stroke-linecap="round"/>`
  + `<circle cx="45.5" cy="28.6" r="2.7" fill="${C.muted}"/>`
  + `<path d="M7 27 Q8 36 14 38 H26 Q32 36 33 27 Z" fill="${C.elev}" stroke="${C.muted}" stroke-width="2.3"/>`
  + `<ellipse cx="20" cy="27" rx="13" ry="4.2" fill="${C.elev}" stroke="${C.muted}" stroke-width="2.3"/>`
  + `<path d="M8 27 Q20 5 32 27 Z" fill="${C.warm}"/>`
  + `<circle cx="14.5" cy="20" r="1.5" fill="${C.warmDark}"/>`
  + `<circle cx="27" cy="22.5" r="1.5" fill="${C.warmDark}"/>`
  + `<circle cx="12.5" cy="24" r="1.4" fill="${C.warmDark}"/>`
  + `<circle cx="17.5" cy="14.5" r="1.3" fill="${C.grounds}"/>`
  + fullBean(23.5, 18, 5.3, 6.9, 18);

const svgFile = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">${inner}</svg>\n`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log('wrote', path);
}

write('public/favicon.svg', svgFile(simple));
write('docs/logo.svg', svgFile(detailed));

// Horizontal lockup (mark + wordmark) for the README header. Composed as one
// SVG so vertical alignment is exact. Two theme variants (the wordmark colour
// flips) used via <picture> + prefers-color-scheme so it reads on light or
// dark GitHub. The mark sits ~56px tall on the left; "OverDose" centred beside.
const lockup = (textFill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 64" width="210" height="64">`
  + `<g transform="translate(0 4) scale(1.1667)">${detailed}</g>`
  + `<text x="64" y="42" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="30" font-weight="600" fill="${textFill}">OverDose</text>`
  + `</svg>\n`;
write('docs/logo-lockup-light.svg', lockup('#1b1b1b'));
write('docs/logo-lockup-dark.svg', lockup('#ededed'));

const logoTsx =
`import type { Component } from 'solid-js';

/**
 * OverDose brand mark — a portafilter basket "overdosed" with a heaping
 * mound of grounds and a roasted bean on top. Fixed multi-colour artwork
 * (not a currentColor icon), baked from scripts/gen-logo.mjs. A simplified
 * variant lives in public/favicon.svg for tab/skin-list sizes.
 */
const INNER = ${JSON.stringify(detailed)};

export const Logo: Component<{ size?: number; class?: string }> = (p) => (
  <svg
    width={p.size ?? 28}
    height={p.size ?? 28}
    viewBox="0 0 48 48"
    class={p.class}
    role="img"
    aria-label="OverDose"
    innerHTML={INNER}
  />
);
`;
write('src/components/Logo.tsx', logoTsx);
