import { Show, type Component } from 'solid-js';
import type { CleaningKind } from '../domain';
import { FlushIcon, WaterDropIcon } from './icons';

/** Per-kind cleaning glyph: flush drop for Clean, water drop for Descale.
 *  Shared by the Library list, the Maintenance run-list, and the Home alert pill. */
export const CleaningKindIcon: Component<{ kind: CleaningKind; size?: number }> = (
  p,
) => (
  <Show when={p.kind === 'clean'} fallback={<WaterDropIcon size={p.size ?? 18} />}>
    <FlushIcon size={p.size ?? 18} />
  </Show>
);
