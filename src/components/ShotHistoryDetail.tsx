import {
  Show,
  createResource,
  createSignal,
  type Accessor,
  type Component,
} from 'solid-js';
import type { TraceVisibility } from '../prefs';
import {
  api,
  type Bean,
  type GatewayShotRecord,
  type GatewayShotSummary,
  type ShotAnnotationsPatch,
  type ShotPatch,
  type WorkflowContextUpdate,
} from '../api';
import { shotDoseG, shotHeadline } from '../shotStats';
import { ShotReview } from './ShotReview';
import { PickerDialog } from './PickerDialog';
import { BeanPicker } from './settings/sections/library/BeanPicker';
import { DebouncedNumberField } from './settings/sections/library/DebouncedNumberField';
import { CheckIcon, CloseIcon, PencilIcon, TrashIcon } from './icons';

/** Local time-of-day + date, for the delete-confirm subtitle. */
const fmtWhen = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Editable fields of a recorded shot — annotations plus the workflow-context
 *  bean/grind that the prep screen originally set. */
type Draft = {
  enjoyment: number | null;
  notes: string;
  dose: number | undefined;
  beanId: string | undefined;
  coffeeName: string | undefined;
  coffeeRoaster: string | undefined;
  grind: number | undefined;
};

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && !Number.isNaN(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))
      ? Number(v)
      : undefined;

const seed = (s: GatewayShotSummary): Draft => {
  const ctx = s.workflow?.context;
  return {
    enjoyment:
      typeof s.annotations?.enjoyment === 'number'
        ? s.annotations.enjoyment
        : null,
    notes: s.annotations?.espressoNotes ?? '',
    dose: shotDoseG(s) ?? undefined,
    beanId:
      typeof ctx?.extras?.['beanId'] === 'string'
        ? (ctx.extras['beanId'] as string)
        : undefined,
    coffeeName: ctx?.coffeeName,
    coffeeRoaster: ctx?.coffeeRoaster,
    grind: num(ctx?.grinderSetting),
  };
};

const beanLabel = (
  roaster: string | undefined,
  name: string | undefined,
): string | null =>
  name ? (roaster ? `${roaster} · ${name}` : name) : null;

/**
 * Shots-history detail — the shared {@link ShotReview} in "review" mode:
 * read-only until an explicit Edit toggle, then a single Save persists once
 * via `PUT`. Beyond the annotations (rating/notes/dose) it edits the bean
 * (re-associated via {@link BeanPicker}) and the grind setting, written back
 * onto `workflow.context`. Sources the full record (measurements → chart) by
 * id, with no optimistic hand-off.
 */
export const ShotHistoryDetail: Component<{
  shot: GatewayShotSummary;
  onBack: () => void;
  /** Called after a successful save with the updated summary, so the list can
   *  patch the row in place (no refetch). */
  onUpdated?: (shot: GatewayShotSummary) => void;
  /** Called after a successful delete so the list can drop the row. */
  onDeleted: (id: string) => void;
  fetchShot?: (id: string) => Promise<GatewayShotRecord>;
  updateShot?: (id: string, patch: ShotPatch) => Promise<void>;
  deleteShot?: (id: string) => Promise<void>;
  /** Resolve a bean by id (name + roaster) after a re-pick. */
  loadBean?: (id: string) => Promise<Bean | null>;
  /** Bean list for the picker (injected in tests). */
  loadBeans?: () => Promise<Bean[]>;
  /** Saved default trace visibility (Settings), seeding the chart. */
  traceVisibility?: Accessor<TraceVisibility>;
}> = (p) => {
  const [full] = createResource<GatewayShotRecord | null, string>(
    () => p.shot.id,
    (id) => (p.fetchShot ?? api.shotById)(id).catch(() => null),
  );
  const summary = (): GatewayShotSummary => p.shot;

  const init = seed(p.shot);
  const [committed, setCommitted] = createSignal<Draft>(init);
  const [enjoyment, setEnjoyment] = createSignal<number | null>(init.enjoyment);
  const [notes, setNotes] = createSignal(init.notes);
  const [dose, setDose] = createSignal<number | undefined>(init.dose);
  const [beanId, setBeanId] = createSignal<string | undefined>(init.beanId);
  const [coffeeName, setCoffeeName] = createSignal<string | undefined>(
    init.coffeeName,
  );
  const [coffeeRoaster, setCoffeeRoaster] = createSignal<string | undefined>(
    init.coffeeRoaster,
  );
  const [grind, setGrind] = createSignal<number | undefined>(init.grind);

  const [editing, setEditing] = createSignal(false);
  const [saveState, setSaveState] = createSignal<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [beanPickerOpen, setBeanPickerOpen] = createSignal(false);

  const startEdit = (): void => {
    setSaveState('idle');
    setEditing(true);
  };
  const cancelEdit = (): void => {
    const c = committed();
    setEnjoyment(c.enjoyment);
    setNotes(c.notes);
    setDose(c.dose);
    setBeanId(c.beanId);
    setCoffeeName(c.coffeeName);
    setCoffeeRoaster(c.coffeeRoaster);
    setGrind(c.grind);
    setEditing(false);
  };

  const handleBeanSelect = async (id: string): Promise<void> => {
    setBeanPickerOpen(false);
    setBeanId(id);
    const b = await (p.loadBean ?? ((x) => api.beanById(x).catch(() => null)))(
      id,
    );
    if (b) {
      setCoffeeName(b.name);
      setCoffeeRoaster(b.roaster);
    }
  };

  const save = async (): Promise<void> => {
    const c = committed();
    const patch: ShotPatch = {};

    const ann: ShotAnnotationsPatch = { espressoNotes: notes().trim() };
    const e = enjoyment();
    if (e != null) ann.enjoyment = e;
    const d = dose();
    // Only persist dose if the user actually changed it — otherwise a
    // rating/notes edit would write the derived target dose back as "actual".
    if (d != null && d !== c.dose) ann.actualDoseWeight = d;
    patch.annotations = ann;

    // workflow.context — only the bean/grind we touched (gateway deep-merges,
    // preserving the rest of the context). Coffee trio written together.
    const ctx: WorkflowContextUpdate = {};
    const beanChanged =
      beanId() !== c.beanId ||
      coffeeName() !== c.coffeeName ||
      coffeeRoaster() !== c.coffeeRoaster;
    if (beanChanged) {
      ctx.coffeeName = coffeeName() ?? null;
      ctx.coffeeRoaster = coffeeRoaster() ?? null;
      ctx.extras = beanId() ? { beanId: beanId() } : null;
    }
    if (grind() !== c.grind) {
      ctx.grinderSetting = grind() != null ? String(grind()) : null;
    }
    if (Object.keys(ctx).length > 0) patch.workflow = { context: ctx };

    setSaveState('saving');
    try {
      await (p.updateShot ?? api.updateShot)(p.shot.id, patch);
      setCommitted({
        enjoyment: e ?? null,
        notes: notes(),
        dose: d,
        beanId: beanId(),
        coffeeName: coffeeName(),
        coffeeRoaster: coffeeRoaster(),
        grind: grind(),
      });
      setSaveState('saved');
      setEditing(false);
      // Reflect the edit in the list immediately (no refetch). Mirror the
      // fields the row reads: annotations + the coffee/grind context.
      p.onUpdated?.({
        ...p.shot,
        annotations: {
          ...p.shot.annotations,
          enjoyment: e,
          espressoNotes: notes().trim(),
          actualDoseWeight: d ?? p.shot.annotations?.actualDoseWeight ?? null,
        },
        workflow: {
          ...p.shot.workflow,
          context: {
            ...p.shot.workflow?.context,
            coffeeName: coffeeName(),
            coffeeRoaster: coffeeRoaster(),
            grinderSetting: grind(),
            extras: beanId()
              ? { ...p.shot.workflow?.context?.extras, beanId: beanId() }
              : p.shot.workflow?.context?.extras,
          },
        },
      });
    } catch {
      setSaveState('error');
    }
  };

  const doDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await (p.deleteShot ?? api.deleteShot)(p.shot.id);
      setConfirmOpen(false);
      p.onDeleted(p.shot.id);
    } catch {
      setSaveState('error');
      setDeleting(false);
    }
  };

  // Coffee + Grind as two label-on-top fields, rendered the same way in view
  // (value) and edit (control) so the left column reads uniformly. Returned as
  // a fragment so they sit as peer fields beside Dose / Rate / Notes.
  const coffeeSection = (
    <>
      <Show
        when={editing()}
        fallback={
          <div class="shot-field">
            <span class="review-field__label">Bean</span>
            <span class="shot-field__value" data-testid="shot-detail-coffee">
              <Show
                when={coffeeName()}
                fallback={<span class="muted">No bean</span>}
              >
                {coffeeName()}
              </Show>
            </span>
            <Show when={coffeeRoaster()}>
              <span class="shot-field__sub" data-testid="shot-detail-roaster">
                {coffeeRoaster()}
              </span>
            </Show>
          </div>
        }
      >
        {/* Edit re-picks the whole bean in one action, so it's a single
            single control rather than split name/roaster fields. */}
        <div class="shot-field">
          <span class="review-field__label">Bean</span>
          <button
            type="button"
            class="btn shot-coffee__bean"
            data-testid="shot-detail-bean"
            onClick={() => setBeanPickerOpen(true)}
          >
            {beanLabel(coffeeRoaster(), coffeeName()) ?? 'Choose bean'}
          </button>
        </div>
      </Show>
      <div class="shot-field">
        <span class="review-field__label">Grind</span>
        <Show
          when={editing()}
          fallback={
            <span
              class="shot-field__value"
              data-testid="shot-detail-grind-value"
            >
              {grind() ?? '—'}
            </span>
          }
        >
          <DebouncedNumberField
            value={grind()}
            onCommit={setGrind}
            min={0}
            step={0.1}
            ariaLabel="Grind setting"
            testId="shot-detail-grind"
            class="rstat__input"
            debounceMs={0}
          />
        </Show>
      </div>
    </>
  );

  return (
    <>
      <ShotReview
        testIdPrefix="shot-detail"
        chartSide={true}
        defaultVisibility={p.traceVisibility}
        summary={summary}
        full={() => full() ?? null}
        loading={() => full.loading}
        editable={editing}
        enjoyment={enjoyment}
        onEnjoyment={setEnjoyment}
        notes={notes}
        onNotes={setNotes}
        actualDose={dose}
        onActualDose={setDose}
        doseDebounceMs={0}
        leadingLeft={coffeeSection}
        headerLeading={
          <button
            type="button"
            class="btn shot-detail__back"
            data-testid="shot-detail-back"
            onClick={p.onBack}
          >
            ‹ Shots
          </button>
        }
        belowStats={
          <Show
            when={editing()}
            fallback={
              <div class="shot-detail__actions">
                <Show when={saveState() === 'saved'}>
                  <span class="shot-detail__saved" aria-live="polite">
                    Saved ✓
                  </span>
                </Show>
                <button
                  type="button"
                  class="btn shot-detail__btn"
                  data-testid="shot-detail-edit"
                  onClick={startEdit}
                >
                  <PencilIcon size={16} />
                  Edit
                </button>
              </div>
            }
          >
            <div class="shot-detail__actions">
              <button
                type="button"
                class="btn shot-detail__btn shot-detail__delete"
                data-testid="shot-detail-delete"
                onClick={() => setConfirmOpen(true)}
              >
                <TrashIcon size={16} />
                Delete
              </button>
              <button
                type="button"
                class="btn shot-detail__btn"
                data-testid="shot-detail-cancel"
                onClick={cancelEdit}
              >
                <CloseIcon size={16} />
                Cancel
              </button>
              <button
                type="button"
                class="btn btn--primary shot-detail__btn"
                data-testid="shot-detail-save"
                onClick={() => void save()}
              >
                <CheckIcon size={16} />
                {saveState() === 'saving' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Show>
        }
      />

      <PickerDialog
        open={beanPickerOpen()}
        onClose={() => setBeanPickerOpen(false)}
        title="Choose a bean"
        description="Sets the bean recorded for this shot."
        testId="shot-detail-bean-dialog"
      >
        <BeanPicker
          selectedId={beanId()}
          onSelect={(id) => void handleBeanSelect(id)}
          onCancel={() => setBeanPickerOpen(false)}
          loadBeans={p.loadBeans}
        />
      </PickerDialog>

      <PickerDialog
        open={confirmOpen()}
        onClose={() => setConfirmOpen(false)}
        title="Delete this shot?"
        description="This permanently removes it from the machine and can’t be undone."
        testId="shot-delete-confirm"
        maxWidthPx={420}
        footer={
          <>
            <button
              type="button"
              class="btn"
              data-testid="shot-delete-cancel"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn--danger"
              data-testid="shot-delete-go"
              disabled={deleting()}
              onClick={() => void doDelete()}
            >
              {deleting() ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p class="shot-delete-confirm__shot">
          <strong>{shotHeadline(p.shot)}</strong>
          <br />
          {fmtWhen(p.shot.timestamp)}
        </p>
      </PickerDialog>
    </>
  );
};
