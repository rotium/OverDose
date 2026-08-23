import type { Vessel } from '../domain';

/**
 * Seed Vessels shipped on first run so the Hot Water library and the prep
 * picker aren't empty. Two everyday sizes; the user renames, retunes and adds
 * more in Library → Hot Water. IDs are stable so a re-seed never duplicates.
 *
 * Nothing here is read from the machine. A new vessel is a different size by
 * definition, so there is nothing worth copying from the current hot-water
 * settings — and the seed would have cost an `hotWaterFlow` MMR read over BLE.
 */
export const SEED_VESSELS: Vessel[] = [
  {
    id: 'seed-vessel-cup',
    name: 'Cup',
    capacityMl: 150,
    flow: 6.0,
  },
  {
    id: 'seed-vessel-mug',
    name: 'Mug',
    capacityMl: 300,
    flow: 6.0,
  },
];
