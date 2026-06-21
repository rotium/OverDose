import type { Bean } from './api';

export interface RoasterGroup {
  roaster: string;
  beans: Bean[];
}

/**
 * The bean's manual rating (0–100, same scale as a shot's enjoyment), or
 * `null` when unrated. Stored in `extras.rating` rather than a typed Bean
 * field so it needs no gateway schema change. Shared by the bean editor (which
 * writes it) and the library/picker rows (which show the face).
 */
export function beanRating(b: Bean): number | null {
  const r = b.extras?.['rating'];
  return typeof r === 'number' ? r : null;
}

/**
 * Group beans into a roaster tree: beans sorted by name within each group,
 * groups sorted by roaster. Shared by the Beans library (BeansSection) and the
 * bean picker (BeanPicker) so both surfaces present the same roaster-first
 * organisation.
 */
export function groupBeansByRoaster(beans: Bean[]): RoasterGroup[] {
  const byRoaster = new Map<string, Bean[]>();
  for (const b of beans) {
    const arr = byRoaster.get(b.roaster);
    if (arr) arr.push(b);
    else byRoaster.set(b.roaster, [b]);
  }
  return [...byRoaster.entries()]
    .map(([roaster, items]) => ({
      roaster,
      beans: items.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.roaster.localeCompare(b.roaster));
}
