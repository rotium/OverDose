import {
  For,
  Match,
  Show,
  Switch,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import { api, type Bean, type BeanPatch } from '../../../../api';
import { AutocompleteInput } from './AutocompleteInput';
import { DebouncedNumberField } from './DebouncedNumberField';

const SPECIES = ['Arabica', 'Robusta', 'Liberica', 'Blend'];
const PROCESSING = ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Wet-hulled'];
const DECAF_PROCESSES = ['Swiss Water', 'CO₂', 'Sugarcane (EA)', 'Mountain Water'];

/** Bean text fields that offer autocomplete from existing values. */
export type BeanSuggestField =
  | 'roaster'
  | 'country'
  | 'region'
  | 'producer'
  | 'species'
  | 'processing'
  | 'decafProcess'
  | 'variety';

/** Predefined defaults + values already entered on other beans, deduped
 *  case-insensitively (defaults' casing wins), sorted for a stable list. */
const mergeSuggestions = (defaults: string[], existing?: string[]): string[] => {
  const seen = new Set(defaults.map((s) => s.toLowerCase()));
  const extra = (existing ?? []).filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...defaults, ...extra].sort((a, b) => a.localeCompare(b));
};

export interface BeanEditorProps {
  beanId: string;
  onClose: () => void;
  /** Test seam — load a bean (null when missing). Defaults to the gateway. */
  loadBean?: (id: string) => Promise<Bean | null>;
  /** Test seam — persist a sparse patch. Defaults to the gateway. */
  saveBean?: (id: string, patch: BeanPatch) => Promise<void>;
  /** Test seam — permanently delete. Defaults to the gateway. */
  deleteBean?: (id: string) => Promise<void>;
  /** Distinct values already entered on other beans, per field — feeds each
   *  text field's autocomplete (merged with any built-in defaults). */
  existing?: Partial<Record<BeanSuggestField, string[]>>;
  debounceMs?: number;
}

/**
 * Bean editor — a gateway-owned entity (unlike the local Pitcher/Recipe), so
 * every field commit is a sparse `PUT /api/v1/beans/{id}` rather than a
 * localStorage write. Identity (roaster/name/decaf) is always shown; origin
 * details and tasting notes are collapsed by default. "Remove" archives
 * (soft-delete) so historical shots keep resolving the bean.
 *
 * Because gateway writes can fail (the local repos never could), a failed
 * save surfaces a small inline retry hint instead of silently dropping the
 * edit — the one place we go beyond the read-only profile precedent.
 */
export const BeanEditor: Component<BeanEditorProps> = (p) => {
  const load = (id: string) =>
    (p.loadBean ?? ((i) => api.beanById(i).catch(() => null)))(id);

  const [bean, { refetch }] = createResource(() => p.beanId, load);
  const [saveFailed, setSaveFailed] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  // Autocomplete suggestions for a field: built-in defaults merged with the
  // distinct values already entered on other beans.
  const sugg = (field: BeanSuggestField, defaults: string[] = []) =>
    mergeSuggestions(defaults, p.existing?.[field]);

  const patch = async (body: BeanPatch): Promise<boolean> => {
    setSaveFailed(false);
    try {
      await (p.saveBean ?? ((id, b) => api.updateBean(id, b)))(p.beanId, body);
      void refetch();
      return true;
    } catch (e) {
      console.warn('bean save failed', e);
      setSaveFailed(true);
      return false;
    }
  };

  // Required text (roaster/name): empty input keeps the prior value.
  const setRequired = (key: 'roaster' | 'name', raw: string) => {
    const cur = bean();
    const val = raw.trim();
    if (!cur || !val || cur[key] === val) return;
    void patch({ [key]: val });
  };

  // Optional text: an emptied field is saved as "" rather than null. The
  // gateway can't store an explicit null clear (copyWith uses `?? this`, so
  // null reverts to the old value), but "" survives and reads as empty. Not a
  // true delete — that needs the upstream _updateBean fix — but not annoying.
  // Empties are filtered out of the suggestion lists (see BeansSection).
  const setOptional = (
    key: 'species' | 'decafProcess' | 'country' | 'region' | 'producer' | 'processing' | 'notes',
    raw: string,
  ) => {
    const cur = bean();
    if (!cur) return;
    const next = raw.trim();
    if ((cur[key] ?? '') === next) return;
    void patch({ [key]: next });
  };

  const toggleDecaf = (checked: boolean) =>
    void patch(checked ? { decaf: true } : { decaf: false, decafProcess: '' });

  const addVariety = (raw: string) => {
    const v = raw.trim();
    const cur = bean();
    if (!cur || !v) return;
    const list = cur.variety ?? [];
    if (list.includes(v)) return;
    void patch({ variety: [...list, v] });
  };

  const removeVariety = (v: string) => {
    const cur = bean();
    if (!cur) return;
    // Empty array (not null) so removing the last chip actually clears it —
    // same gateway null-revert caveat as the text fields.
    const list = (cur.variety ?? []).filter((x) => x !== v);
    void patch({ variety: list });
  };

  // Altitude is `[min, max]` integers. A single value fills both ends; both
  // empty clears it.
  const setAltitude = (which: 0 | 1, value: number | undefined) => {
    const cur = bean();
    if (!cur) return;
    const a = cur.altitude ?? [];
    const rounded = value == null ? undefined : Math.round(value);
    const min = which === 0 ? rounded : a[0];
    const max = which === 1 ? rounded : a[1];
    const lo = min ?? max;
    const hi = max ?? min;
    // Empty array (not null) clears it past the gateway's null-revert.
    void patch({ altitude: lo == null ? [] : [lo, hi as number] });
  };

  const destroy = async () => {
    try {
      await (p.deleteBean ?? ((id) => api.deleteBean(id)))(p.beanId);
      p.onClose();
    } catch (e) {
      console.warn('bean delete failed', e);
      setSaveFailed(true);
    }
  };

  const [varietyDraft, setVarietyDraft] = createSignal('');
  const [varietyOpen, setVarietyOpen] = createSignal(false);

  const commitVariety = () => {
    if (varietyDraft().trim()) {
      addVariety(varietyDraft());
      setVarietyDraft('');
    }
  };

  // Varieties used on other beans, minus the ones already on this bean,
  // filtered by what's being typed. Drives the add-input's suggestion list.
  const varietyMatches = (): string[] => {
    const cur = bean();
    if (!cur) return [];
    const already = new Set((cur.variety ?? []).map((v) => v.toLowerCase()));
    const q = varietyDraft().trim().toLowerCase();
    return (p.existing?.variety ?? [])
      .filter((v) => !already.has(v.toLowerCase()))
      .filter((v) => (q === '' ? true : v.toLowerCase().includes(q)))
      .filter((v) => v.toLowerCase() !== q)
      .slice(0, 8);
  };
  const showVarietyList = () => varietyOpen() && varietyMatches().length > 0;

  return (
    <div class="settings-section-stack bean-editor" data-testid="bean-editor">
      <h2 class="routine-editor__title">Edit bean</h2>

      <Switch>
        {/* Only on the initial load — during a post-save refetch `bean()` still
            holds the previous value, so we keep the form mounted (otherwise the
            <details> sections collapse on every field edit). */}
        <Match when={bean.loading && bean() === undefined}>
          <p class="muted">loading…</p>
        </Match>
        <Match when={bean() === null}>
          <p class="muted" role="alert">
            bean not found
          </p>
        </Match>
        <Match when={bean()}>
          {(b) => (
            <>
              <Show when={saveFailed()}>
                <p class="muted" role="alert" data-testid="bean-save-error">
                  Couldn't save — check the gateway connection and try again.
                </p>
              </Show>

              <section class="settings-section">
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Roaster</span>
                  <AutocompleteInput
                    value={b().roaster}
                    suggestions={sugg('roaster')}
                    onChange={(v) => setRequired('roaster', v)}
                    ariaLabel="Roaster"
                    testId="bean-roaster-input"
                    class="bean-editor__input"
                  />
                </label>
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Name</span>
                  <input
                    type="text"
                    class="bean-editor__input"
                    value={b().name}
                    aria-label="Bean name"
                    data-testid="bean-name-input"
                    onChange={(e) => setRequired('name', e.currentTarget.value)}
                  />
                </label>
              </section>

              <details class="settings-section bean-editor__group">
                <summary>Origin &amp; details</summary>
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Country</span>
                  <AutocompleteInput
                    value={b().country ?? ''}
                    suggestions={sugg('country')}
                    onChange={(v) => setOptional('country', v)}
                    ariaLabel="Country"
                    testId="bean-country-input"
                    class="bean-editor__input"
                  />
                </label>
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Region</span>
                  <AutocompleteInput
                    value={b().region ?? ''}
                    suggestions={sugg('region')}
                    onChange={(v) => setOptional('region', v)}
                    ariaLabel="Region"
                    testId="bean-region-input"
                    class="bean-editor__input"
                  />
                </label>
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Producer</span>
                  <AutocompleteInput
                    value={b().producer ?? ''}
                    suggestions={sugg('producer')}
                    onChange={(v) => setOptional('producer', v)}
                    ariaLabel="Producer"
                    testId="bean-producer-input"
                    class="bean-editor__input"
                  />
                </label>
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Species</span>
                  <AutocompleteInput
                    value={b().species ?? ''}
                    suggestions={sugg('species', SPECIES)}
                    onChange={(v) => setOptional('species', v)}
                    ariaLabel="Species"
                    testId="bean-species-input"
                    class="bean-editor__input"
                  />
                </label>
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Processing</span>
                  <AutocompleteInput
                    value={b().processing ?? ''}
                    suggestions={sugg('processing', PROCESSING)}
                    onChange={(v) => setOptional('processing', v)}
                    ariaLabel="Processing"
                    testId="bean-processing-input"
                    class="bean-editor__input"
                  />
                </label>
                <label class="bean-editor__field bean-editor__field--inline">
                  <input
                    type="checkbox"
                    checked={b().decaf}
                    aria-label="Decaf"
                    data-testid="bean-decaf-toggle"
                    onChange={(e) => toggleDecaf(e.currentTarget.checked)}
                  />
                  <span class="bean-editor__field-label">Decaf</span>
                </label>
                <Show when={b().decaf}>
                  <label class="bean-editor__field">
                    <span class="bean-editor__field-label">Decaf process</span>
                    <AutocompleteInput
                      value={b().decafProcess ?? ''}
                      suggestions={sugg('decafProcess', DECAF_PROCESSES)}
                      onChange={(v) => setOptional('decafProcess', v)}
                      placeholder="e.g. Swiss Water, CO₂"
                      ariaLabel="Decaf process"
                      testId="bean-decaf-process-input"
                      class="bean-editor__input"
                    />
                  </label>
                </Show>
                <label class="bean-editor__field">
                  <span class="bean-editor__field-label">Altitude (m)</span>
                  <span class="bean-editor__altitude">
                    <DebouncedNumberField
                      value={b().altitude?.[0]}
                      onCommit={(v) => setAltitude(0, v)}
                      placeholder="min"
                      min={0}
                      step={50}
                      ariaLabel="Altitude minimum (metres)"
                      testId="bean-altitude-min"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />
                    <span class="bean-editor__altitude-sep">–</span>
                    <DebouncedNumberField
                      value={b().altitude?.[1]}
                      onCommit={(v) => setAltitude(1, v)}
                      placeholder="max"
                      min={0}
                      step={50}
                      ariaLabel="Altitude maximum (metres)"
                      testId="bean-altitude-max"
                      debounceMs={p.debounceMs}
                      class="step-field__input"
                    />
                  </span>
                </label>
                <div class="bean-editor__field">
                  <span class="bean-editor__field-label">Variety</span>
                  <div class="bean-editor__chips" data-testid="bean-variety-chips">
                    <For each={b().variety ?? []}>
                      {(v) => (
                        <span class="bean-editor__chip">
                          {v}
                          <button
                            type="button"
                            class="bean-editor__chip-remove"
                            aria-label={`Remove ${v}`}
                            onClick={() => removeVariety(v)}
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </For>
                    <span class="autocomplete bean-editor__variety-add">
                      <input
                        type="text"
                        class="bean-editor__chip-input"
                        placeholder="add variety…"
                        aria-label="Add variety"
                        data-testid="bean-variety-input"
                        autocomplete="off"
                        value={varietyDraft()}
                        onFocus={() => setVarietyOpen(true)}
                        onInput={(e) => {
                          setVarietyDraft(e.currentTarget.value);
                          setVarietyOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitVariety();
                            setVarietyOpen(false);
                          } else if (e.key === 'Escape') {
                            setVarietyOpen(false);
                          }
                        }}
                        onBlur={() => {
                          // Defer so a mousedown on a suggestion adds it first.
                          window.setTimeout(() => setVarietyOpen(false), 120);
                          commitVariety();
                        }}
                      />
                      <Show when={showVarietyList()}>
                        <ul
                          class="autocomplete__list"
                          role="listbox"
                          data-testid="bean-variety-input-list"
                        >
                          <For each={varietyMatches()}>
                            {(v, i) => (
                              <li
                                role="option"
                                class="autocomplete__option"
                                data-testid={`bean-variety-input-option-${i()}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  addVariety(v);
                                  setVarietyDraft('');
                                  setVarietyOpen(false);
                                }}
                              >
                                {v}
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </span>
                  </div>
                </div>
              </details>

              <details class="settings-section bean-editor__group">
                <summary>Tasting notes</summary>
                <textarea
                  class="bean-editor__notes"
                  rows={3}
                  value={b().notes ?? ''}
                  placeholder="chocolate, red fruit…"
                  aria-label="Tasting notes"
                  data-testid="bean-notes-input"
                  onChange={(e) => setOptional('notes', e.currentTarget.value)}
                />
              </details>

              <section class="settings-section">
                <h3>Bags / batches</h3>
                <p class="settings-help">
                  Coming next — roast date, weight, and freshness per bag.
                </p>
              </section>

              <section class="settings-section">
                {/* Archive is a reversible toggle (like a recipe's "hide from
                    home"), so it's a checkbox and leaves the editor open.
                    Delete is the irreversible escape hatch and closes. */}
                <label class="settings-checkbox" data-testid="bean-archive-toggle-label">
                  <input
                    type="checkbox"
                    checked={b().archived}
                    data-testid="bean-archive-toggle"
                    onChange={(e) =>
                      void patch({ archived: e.currentTarget.checked })
                    }
                  />
                  <span>Archive — hide from lists</span>
                </label>

                <Show when={!confirmingDelete()}>
                  <button
                    type="button"
                    class="btn btn--danger bean-editor__delete-btn"
                    data-testid="delete-bean-button"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete permanently
                  </button>
                </Show>
                <Show when={confirmingDelete()}>
                  <div
                    class="routine-editor__delete-confirm"
                    data-testid="delete-confirm"
                  >
                    <p>
                      Permanently delete "{b().roaster} — {b().name}"? This
                      can't be undone. Past shots keep the coffee name.
                    </p>
                    <div class="routine-editor__button-row">
                      <button
                        type="button"
                        class="btn btn--danger"
                        data-testid="confirm-delete-bean-button"
                        onClick={destroy}
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        class="btn"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </Show>
              </section>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};
