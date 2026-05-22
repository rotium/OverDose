import type { Pipeline } from './pipeline';

/**
 * Workflow: a Pipeline plus its configuration values. Configuration is carried
 * by each Step's `config` (per-Step) — the Workflow doesn't add a separate
 * flat config blob. Workflows are user-configurable (full CRUD).
 *
 * Runtime overrides don't mutate the Workflow — they produce an ephemeral
 * "run" with overridden values. See [[starter-skin-vocabulary]].
 */
export interface Workflow {
  id: string;
  name: string;
  pipeline: Pipeline;
  /** Optional path to a tile image displayed in the picker. */
  iconUrl?: string;
}
