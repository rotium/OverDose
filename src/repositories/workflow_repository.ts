import type { Workflow } from '../domain';

/**
 * Repository for Workflows. Promise-returning so the gateway-backed swap-in
 * later (per [[starter-skin-storage]]) doesn't require call-site changes.
 *
 * Operations are fixed code, NOT a repository concern. Pipelines/Beans/Profiles/
 * Grinders will follow the same pattern but live in their own repository files
 * to keep concerns isolated.
 */
export interface WorkflowRepository {
  list(): Promise<Workflow[]>;
  get(id: string): Promise<Workflow | null>;
  create(workflow: Workflow): Promise<Workflow>;
  update(workflow: Workflow): Promise<Workflow>;
  delete(id: string): Promise<void>;
}
