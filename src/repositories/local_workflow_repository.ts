import type { Workflow } from '../domain';
import type { WorkflowRepository } from './workflow_repository';
import { SEED_WORKFLOWS } from './seed_workflows';

const STORAGE_KEY = 'starter-skin.workflows.v1';
const SEEDED_FLAG = 'starter-skin.workflows.seeded.v1';

/**
 * Browser-local WorkflowRepository backed by localStorage. Small object count
 * (tens, not thousands) — localStorage is adequate; IndexedDB upgrade can come
 * later behind the same interface without touching callers.
 *
 * Storage is injected so tests can use a fresh in-memory store rather than
 * polluting the real localStorage. Production callers pass `globalThis.localStorage`.
 */
export class LocalWorkflowRepository implements WorkflowRepository {
  constructor(private readonly storage: Storage = globalThis.localStorage) {
    this.seedIfFirstRun();
  }

  async list(): Promise<Workflow[]> {
    return this.readAll();
  }

  async get(id: string): Promise<Workflow | null> {
    return this.readAll().find((w) => w.id === id) ?? null;
  }

  async create(workflow: Workflow): Promise<Workflow> {
    const all = this.readAll();
    if (all.some((w) => w.id === workflow.id)) {
      throw new Error(`Workflow with id "${workflow.id}" already exists`);
    }
    all.push(workflow);
    this.writeAll(all);
    return workflow;
  }

  async update(workflow: Workflow): Promise<Workflow> {
    const all = this.readAll();
    const idx = all.findIndex((w) => w.id === workflow.id);
    if (idx === -1) throw new Error(`Workflow "${workflow.id}" not found`);
    all[idx] = workflow;
    this.writeAll(all);
    return workflow;
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll();
    const idx = all.findIndex((w) => w.id === id);
    if (idx === -1) return;
    all.splice(idx, 1);
    this.writeAll(all);
  }

  private seedIfFirstRun(): void {
    if (this.storage.getItem(SEEDED_FLAG) === '1') return;
    if (this.readAll().length === 0) this.writeAll(SEED_WORKFLOWS);
    this.storage.setItem(SEEDED_FLAG, '1');
  }

  private readAll(): Workflow[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Workflow[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(workflows: Workflow[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  }
}
