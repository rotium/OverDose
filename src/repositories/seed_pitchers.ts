import type { Pitcher } from '../domain';

/**
 * Seed Pitchers shipped on first run so the Library and Recipe picker aren't
 * empty. Two common jug sizes with sensible starting steam parameters — the
 * user tunes them in Library → Steam. IDs are stable so a re-seed never
 * duplicates.
 */
export const SEED_PITCHERS: Pitcher[] = [
  {
    id: 'seed-pitcher-small',
    name: 'Small',
    capacityMl: 350,
    steamDurationSec: 30,
    steamTempC: 150,
    steamFlow: 0.8,
  },
  {
    id: 'seed-pitcher-large',
    name: 'Large',
    capacityMl: 600,
    steamDurationSec: 50,
    steamTempC: 150,
    steamFlow: 0.8,
  },
];
