import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import {
  formatStepType,
  type Routine,
  type RoutineStep,
  type Recipe,
  type StepType,
} from '../domain';
import { useRepositories } from '../RepositoriesContext';
import {
  isHeaterOff,
  isWarmingUp,
  type MachineSnapshot,
  type MachineState,
} from '../snapshot';
import { PowerIcon, ThermometerIcon, WaterDropIcon } from './icons';
import type { WsStream } from '../streams';
import {
  api,
  type GatewayShotRecord,
  type GatewayShotSummary,
  type ProfileRecord,
  type ShotAnnotationsPatch,
  type WorkflowUpdate,
} from '../api';
import { ShotRatingFace } from './ShotRatingFace';
import { buildProfileCurve } from '../profile/curve';
import { ShotMiniChart } from './ShotMiniChart';
import { deriveShotStats } from '../shotStats';
import { TRACE_COLOR } from './chartTraces';
import {
  DEFAULT_TRACE_VISIBILITY,
  type TraceKey,
  type TraceVisibility,
} from '../prefs';
import { ProfileCurveChart } from './settings/sections/library/ProfileCurveChart';
import { ProfilePicker } from './settings/sections/library/ProfilePicker';
import { PickerDialog } from './PickerDialog';
import { DebouncedNumberField } from './settings/sections/library/DebouncedNumberField';

/**
 * Recipe-driven brewing runtime — full-screen replacement for Home that
 * walks the user through a Recipe's steps one at a time. The screen owns
 * step orchestration (prep + start request); the live in-progress UI is
 * still handled by the existing LiveBrewDrawer overlay (per the agreed
 * scope — see [[starter-skin-brew-runtime]]).
 *
 * State machine per step:
 *
 *   pending   — not yet attempted; the prep card + Start button is shown
 *               for the *current* one of these.
 *   requested — user tapped Start; we called requestState() and are
 *               waiting for the gateway to enter the matching machine
 *               state. Brief — usually flips to running within a frame.
 *   running   — machine is in the requested state; we're waiting for it
 *               to leave (back to idle / something else).
 *   done      — machine left the requested state. Step is complete.
 *   skipped   — user clicked a later step in the step bar, skipping past
 *               this one.
 *
 * Step → gateway-state map: brew→espresso, steam→steam, water→hotWater,
 * flush→flush. (Reaprime's MachineState type — see `snapshot.ts`.)
 *
 * Auto-mode is deliberately not implemented yet — manual only. See
 * [[starter-skin-brew-auto-mode]] for the failure-detection and config
 * surface considerations that need to be resolved first.
 */
export type StepStatus =
  | 'pending'
  | 'requested'
  | 'running'
  | 'done'
  | 'skipped';

export const stepToGatewayState = (t: StepType): MachineState => {
  switch (t) {
    case 'brew':
      return 'espresso';
    case 'steam':
      return 'steam';
    case 'water':
      return 'hotWater';
    case 'flush':
      return 'flush';
  }
};

export interface RecipeBrewScreenProps {
  recipeId: string;
  /** Ad-hoc bundle override — when provided, the screen uses this
   *  recipe+routine directly instead of looking `recipeId` up in the
   *  repositories. Used by the Explore "Brew" flow, which builds a one-off
   *  brew from the gateway's current workflow (no saved Recipe). */
  bundleOverride?: BrewBundle;
  /** Returns the user to Home; called by the back arrow and Done. */
  onExit: () => void;
  /** Streams the machine snapshot — used to detect step-end transitions. */
  machineStream: () => WsStream<MachineSnapshot>;
  /** True when the water tank is below the brewing-block threshold.
   *  Optional — when omitted (e.g. unit tests that don't care), water
   *  gating is off. App.tsx supplies the real signal. */
  isWaterCritical?: Accessor<boolean>;
  /** Fires a gateway state request (typically `api.requestState`). */
  requestState: (state: MachineState) => Promise<void>;
  /** Single-profile fetcher used to render the brew step's prep card.
   *  Resolves to `null` on any failure (deleted, hidden, gateway offline)
   *  so the prep card degrades to a graceful "(missing profile)" hint
   *  instead of crashing the resource. Default mirrors that contract. */
  loadProfileById?: (id: string) => Promise<ProfileRecord | null>;
  /** Profile-list fetcher for the "Change profile" picker dialog. Defaults
   *  to `api.profiles({})`. */
  loadProfiles?: () => Promise<ProfileRecord[]>;
  /** Pushes the brew workflow (profile + shot context) to the gateway.
   *  Defaults to `api.setWorkflow`. Injected so tests can capture the
   *  payload without hitting the network. */
  onApplyWorkflow?: (body: WorkflowUpdate) => Promise<void> | void;
  /** Latest shot summary fetcher for the post-brew result (defaults to
   *  `api.shotsLatest`). */
  fetchLatestShot?: () => Promise<GatewayShotSummary>;
  /** Full shot record fetcher (measurements) for the result chart +
   *  stats (defaults to `api.shotById`). */
  fetchShot?: (id: string) => Promise<GatewayShotRecord>;
  /** In-memory optimistic shot from the live accumulator — paints the
   *  result instantly while `/shots/latest` catches up. */
  optimisticShot?: Accessor<GatewayShotRecord | null>;
  /** Persists post-shot annotations (rating, notes, corrected dose) from
   *  the result screen. Defaults to `api.updateShotAnnotations`. */
  updateShot?: (id: string, patch: ShotAnnotationsPatch) => Promise<void>;
  /** Auto-save debounce for the annotation capture (ms). Default 700;
   *  tests pass 0 for synchronous saves. */
  saveDebounceMs?: number;
}

/**
 * Per-shot draft of the brew parameters. Seeded from the Recipe when the
 * screen opens, then edited freely in the prep card — these are ephemeral
 * overrides for *this shot only* and never write back to the saved Recipe
 * (they're the "run-time override" layer of the effective-config chain;
 * see [[starter-skin-vocabulary]]). The eventual gateway push reads from
 * here, not from the Recipe.
 */
interface ShotDraft {
  profileId?: string;
  doseGrams?: number;
  grinderSetting?: number;
  targetYieldGrams?: number;
  targetVolumeMl?: number;
}

export interface BrewBundle {
  recipe: Recipe | null;
  routine: Routine | null;
}

export const RecipeBrewScreen: Component<RecipeBrewScreenProps> = (p) => {
  const repos = useRepositories();
  const machine = p.machineStream();

  // Gates the Start button + tints the current step bar item when the
  // DE1's boiler isn't at target yet. Same `isWarmingUp` heuristic the
  // Header pill uses, so the visual story is consistent across screens.
  const isWarming = (): boolean => isWarmingUp(machine.latest() ?? null);
  // Heater-off (front switch off): substate=errorNoAC. Takes priority
  // over warming when both could apply — the user has to physically
  // flip a switch before any warming can happen.
  const heaterOff = (): boolean => isHeaterOff(machine.latest() ?? null);
  // Water-critical (tank below block threshold). Wins over warming on
  // the Start button — refilling is a precondition for further heating
  // to even matter — but heater-off still trumps water-critical.
  const waterCritical = (): boolean => p.isWaterCritical?.() ?? false;

  // Combined fetch so the header + body don't render a half-loaded state
  // (recipe arrived but routine still pending — the previous two-resource
  // setup was racy in jsdom even though it usually settled fast in browsers).
  const [bundle] = createResource<BrewBundle, string>(
    () => p.recipeId,
    async (id): Promise<BrewBundle> => {
      // Ad-hoc Explore brew: use the injected bundle, skip the repo lookup.
      if (p.bundleOverride) return p.bundleOverride;
      const recipe = await repos.recipes.get(id);
      if (!recipe) return { recipe: null, routine: null };
      const routine = await repos.routines.get(recipe.routineId);
      return { recipe, routine };
    },
  );

  const recipe = (): Recipe | null | undefined =>
    bundle.loading ? undefined : (bundle()?.recipe ?? null);
  const routine = (): Routine | null | undefined =>
    bundle.loading ? undefined : (bundle()?.routine ?? null);

  const steps = (): RoutineStep[] => routine()?.steps ?? [];

  // Per-shot draft — seeded once from the Recipe when it first resolves,
  // then edited in the prep card without touching the stored Recipe.
  const [draft, setDraft] = createSignal<ShotDraft | null>(null);
  createEffect(() => {
    const r = bundle()?.recipe;
    if (r && draft() === null) {
      setDraft({
        profileId: r.profileId,
        doseGrams: r.doseGrams,
        grinderSetting: r.grinderSetting,
        targetYieldGrams: r.targetYieldGrams,
        targetVolumeMl: r.targetVolumeMl,
      });
    }
  });
  const patchDraft = (patch: Partial<ShotDraft>) => {
    const d = draft();
    if (!d) return;
    setDraft({ ...d, ...patch });
  };

  // Resolve the draft's profile at the screen level — used both to render
  // the prep card and to build the gateway push. Null-on-error contract.
  const profileLoader = (id: string): Promise<ProfileRecord | null> =>
    (p.loadProfileById ?? ((x) => api.profileById(x).catch(() => null)))(id);
  const [profile] = createResource<ProfileRecord | null, string>(
    () => draft()?.profileId,
    (id) => profileLoader(id),
  );

  // Push the brew workflow to the gateway whenever the draft (or its
  // resolved profile) changes. Pushing reactively *during prep* — rather
  // than at the instant of Start — gives the BLE profile upload ample time
  // to complete before the user brews, and keeps the machine in sync with
  // the prep card (WYSIWYG). The gateway deep-merges + debounces, and only
  // re-uploads the profile to the machine when it actually changed.
  const applyWorkflow = (body: WorkflowUpdate): void => {
    try {
      const r = (p.onApplyWorkflow ?? ((b) => api.setWorkflow(b)))(body);
      if (r && typeof (r as Promise<void>).catch === 'function') {
        void (r as Promise<void>).catch((e) =>
          console.warn('apply workflow failed', e),
        );
      }
    } catch (e) {
      console.warn('apply workflow failed', e);
    }
  };
  createEffect(() => {
    const d = draft();
    const rec = bundle()?.recipe;
    const prof = profile();
    if (!d || !rec) return;
    // Only push when we have a resolved profile to load. No profileId (or
    // a profile that failed to resolve) → don't half-configure the machine;
    // the brew step, if reached, runs whatever profile is already loaded.
    if (!prof) return;
    // Override the profile's target_volume only when the draft sets one.
    // The spread carries every runtime field of the received profile (our
    // TS type is a subset), so the full profile round-trips intact.
    const profileObj =
      d.targetVolumeMl != null
        ? { ...prof.profile, target_volume: d.targetVolumeMl }
        : prof.profile;
    applyWorkflow({
      name: rec.name,
      profile: profileObj,
      context: {
        // `?? null` syncs the gateway to the draft: a cleared field clears
        // it on the machine rather than leaving a stale value.
        targetDoseWeight: d.doseGrams ?? null,
        targetYield: d.targetYieldGrams ?? null,
        grinderSetting:
          d.grinderSetting != null ? String(d.grinderSetting) : null,
      },
    });
  });

  // Per-step status — defaults all to 'pending' until the recipe + routine
  // load. Re-seeds whenever the step list arrives (so a different recipe
  // mid-screen doesn't carry over old statuses).
  const [statuses, setStatuses] = createSignal<StepStatus[]>([]);
  createEffect(() => {
    const len = steps().length;
    setStatuses((prev) =>
      prev.length === len ? prev : Array.from({ length: len }, () => 'pending'),
    );
  });

  const currentIdx = createMemo<number>(() => {
    const ss = statuses();
    const idx = ss.findIndex((s) => s !== 'done' && s !== 'skipped');
    return idx === -1 ? ss.length : idx; // ss.length === recipe finished
  });

  const isFinished = (): boolean =>
    statuses().length > 0 && currentIdx() === statuses().length;

  // Detect step-end via the machine snapshot. The per-step status itself
  // acts as memory — `requested` ⇒ waiting to enter the target state;
  // `running` ⇒ waiting to leave it — so we don't need to track previous
  // states externally.
  createEffect(() => {
    const snap = machine.latest();
    if (!snap) return;
    const cur = snap.state.state;
    const idx = currentIdx();
    const ss = statuses();
    const step = steps()[idx];
    if (!step) return;
    const target = stepToGatewayState(step.type);
    if (ss[idx] === 'requested' && cur === target) {
      updateStatus(idx, 'running');
    } else if (ss[idx] === 'running' && cur !== target) {
      updateStatus(idx, 'done');
    }
  });

  const updateStatus = (idx: number, next: StepStatus) => {
    setStatuses((prev) => {
      if (prev[idx] === next) return prev;
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  };

  const startCurrentStep = () => {
    const idx = currentIdx();
    const step = steps()[idx];
    if (!step) return;
    updateStatus(idx, 'requested');
    void p.requestState(stepToGatewayState(step.type)).catch((e) => {
      console.warn('requestState failed', e);
      updateStatus(idx, 'pending');
    });
  };

  /** Click a future step in the step bar to skip ahead to it. */
  const jumpToStep = (targetIdx: number) => {
    setStatuses((prev) => {
      const copy = [...prev];
      for (let i = currentIdx(); i < targetIdx; i++) {
        if (copy[i] === 'pending') copy[i] = 'skipped';
      }
      return copy;
    });
  };

  const resetForBrewAgain = () => {
    setStatuses(Array.from({ length: steps().length }, () => 'pending'));
  };

  return (
    <main class="brew-screen" data-testid="recipe-brew-screen">
      <BrewHeader recipe={recipe} routine={routine} onExit={p.onExit} />

      <Switch>
        <Match when={bundle.loading}>
          <p class="muted brew-screen__loading">loading recipe…</p>
        </Match>
        <Match when={recipe() === null}>
          <p class="muted brew-screen__loading" role="alert">
            recipe not found
          </p>
        </Match>
        <Match when={routine() === null}>
          <p class="muted brew-screen__loading" role="alert">
            parent routine not found
          </p>
        </Match>
        <Match when={steps().length === 0}>
          <p class="muted brew-screen__loading">
            this routine has no steps yet
          </p>
        </Match>
        <Match when={recipe() && routine() && steps().length > 0}>
          {/* Step bar is a progress indicator for an in-progress recipe —
              hidden on the result screen to give the chart the full height. */}
          <Show when={!isFinished()}>
            <StepBar
              steps={steps}
              statuses={statuses}
              currentIdx={currentIdx}
              isWarming={isWarming}
              isHeaterOff={heaterOff}
              isWaterCritical={waterCritical}
              onJump={jumpToStep}
            />
          </Show>

          <section class="brew-screen__body">
            <Show
              when={!isFinished()}
              fallback={
                <PostBrewView
                  onDone={p.onExit}
                  onBrewAgain={resetForBrewAgain}
                  fetchLatestShot={p.fetchLatestShot}
                  fetchShot={p.fetchShot}
                  optimisticShot={p.optimisticShot}
                  updateShot={p.updateShot}
                  saveDebounceMs={p.saveDebounceMs}
                />
              }
            >
              <PrepCard
                step={() => steps()[currentIdx()]!}
                draft={draft}
                patchDraft={patchDraft}
                status={() => statuses()[currentIdx()]!}
                isWarming={isWarming}
                isHeaterOff={heaterOff}
                isWaterCritical={waterCritical}
                onStart={startCurrentStep}
                profile={() => profile() ?? null}
                profileLoading={() => profile.loading}
                loadProfiles={p.loadProfiles}
              />
            </Show>
          </section>
        </Match>
      </Switch>
    </main>
  );
};

// ─── Subcomponents ──────────────────────────────────────────────────────

const BrewHeader: Component<{
  recipe: Accessor<Recipe | null | undefined>;
  routine: Accessor<Routine | null | undefined>;
  onExit: () => void;
}> = (p) => (
  <header class="brew-screen__header">
    <button
      type="button"
      class="icon-btn brew-screen__back"
      aria-label="Back to Home"
      data-testid="brew-back-button"
      onClick={p.onExit}
    >
      ←
    </button>
    <h1 class="brew-screen__title">
      <span
        class="brew-screen__recipe-name"
        data-testid="brew-recipe-name"
      >
        {p.recipe()?.name ?? '…'}
      </span>
      <span
        class="brew-screen__routine-name"
        data-testid="brew-routine-name"
      >
        {p.routine()?.name ?? '…'}
      </span>
    </h1>
  </header>
);

const StepBar: Component<{
  steps: Accessor<RoutineStep[]>;
  statuses: Accessor<StepStatus[]>;
  currentIdx: Accessor<number>;
  isWarming: Accessor<boolean>;
  isHeaterOff: Accessor<boolean>;
  isWaterCritical: Accessor<boolean>;
  onJump: (idx: number) => void;
}> = (p) => (
  <ol class="step-bar" data-testid="step-bar">
    <For each={p.steps()}>
      {(s, i) => {
        const status = () => p.statuses()[i()] ?? 'pending';
        const isCurrent = () => i() === p.currentIdx();
        const variant = (): 'done' | 'current' | 'future' | 'skipped' => {
          const st = status();
          if (st === 'done') return 'done';
          if (st === 'skipped') return 'skipped';
          if (isCurrent()) return 'current';
          return 'future';
        };
        const clickable = () => i() > p.currentIdx();
        // Tint only the current step while the machine isn't ready —
        // future steps stay neutral; the user can still see what's
        // coming. Priority: heater-off > water-critical > warming.
        const heaterOff = () => isCurrent() && p.isHeaterOff();
        const waterCritical = () =>
          isCurrent() && p.isWaterCritical() && !heaterOff();
        const warming = () =>
          isCurrent() && p.isWarming() && !heaterOff() && !waterCritical();
        return (
          <li
            class="step-bar__item"
            data-variant={variant()}
            data-warming={warming() ? 'true' : undefined}
            data-heater-off={heaterOff() ? 'true' : undefined}
            data-water-critical={waterCritical() ? 'true' : undefined}
            data-testid={`step-bar-item-${i()}`}
          >
            <button
              type="button"
              class="step-bar__button"
              data-testid={`step-bar-button-${i()}`}
              disabled={!clickable()}
              aria-current={isCurrent() ? 'step' : undefined}
              onClick={() => clickable() && p.onJump(i())}
            >
              <span class="step-bar__icon" aria-hidden="true">
                <Switch
                  fallback={
                    variant() === 'done'
                      ? '✓'
                      : variant() === 'skipped'
                        ? '–'
                        : i() + 1
                  }
                >
                  <Match when={heaterOff()}>
                    <PowerIcon size={14} />
                  </Match>
                  <Match when={waterCritical()}>
                    <WaterDropIcon size={14} />
                  </Match>
                  <Match when={warming()}>
                    <ThermometerIcon size={14} />
                  </Match>
                </Switch>
              </span>
              <span class="step-bar__label">{formatStepType(s.type)}</span>
            </button>
          </li>
        );
      }}
    </For>
  </ol>
);

const PrepCard: Component<{
  step: Accessor<RoutineStep>;
  draft: Accessor<ShotDraft | null>;
  patchDraft: (patch: Partial<ShotDraft>) => void;
  status: Accessor<StepStatus>;
  isWarming: Accessor<boolean>;
  isHeaterOff: Accessor<boolean>;
  isWaterCritical: Accessor<boolean>;
  onStart: () => void;
  profile: Accessor<ProfileRecord | null>;
  profileLoading: Accessor<boolean>;
  loadProfiles?: () => Promise<ProfileRecord[]>;
}> = (p) => (
  <section class="prep" data-testid="prep-card">
    <header class="prep__heading">
      <span class="prep__eyebrow">Prep for</span>
      <h2 class="prep__title">{formatStepType(p.step().type)}</h2>
    </header>

    <div class="prep__body">
      <Switch>
        <Match when={p.step().type === 'brew'}>
          <BrewPrep
            draft={p.draft}
            patchDraft={p.patchDraft}
            profile={p.profile}
            profileLoading={p.profileLoading}
            loadProfiles={p.loadProfiles}
          />
        </Match>
        <Match when={p.step().type !== 'brew'}>
          <p class="prep__no-params">No prep needed.</p>
        </Match>
      </Switch>
    </div>

    <footer class="prep__action">
      <Show
        when={p.status() === 'pending'}
        fallback={
          <p
            class="prep__running"
            data-testid="prep-card-running"
            aria-live="polite"
          >
            {formatStepType(p.step().type)} in progress…
          </p>
        }
      >
        <button
          type="button"
          class="btn btn--primary prep__start"
          data-testid="prep-card-start"
          data-heater-off={p.isHeaterOff() ? 'true' : undefined}
          data-water-critical={
            p.isWaterCritical() && !p.isHeaterOff() ? 'true' : undefined
          }
          data-warming={
            p.isWarming() && !p.isHeaterOff() && !p.isWaterCritical()
              ? 'true'
              : undefined
          }
          disabled={p.isWarming() || p.isHeaterOff() || p.isWaterCritical()}
          aria-disabled={
            p.isWarming() || p.isHeaterOff() || p.isWaterCritical()
          }
          onClick={p.onStart}
        >
          <Switch
            fallback={<>Start {formatStepType(p.step().type).toLowerCase()}</>}
          >
            <Match when={p.isHeaterOff()}>
              <PowerIcon size={18} />
              Heater off
            </Match>
            <Match when={p.isWaterCritical()}>
              <WaterDropIcon size={18} />
              Refill water
            </Match>
            <Match when={p.isWarming()}>
              <ThermometerIcon size={18} />
              Warming up…
            </Match>
          </Switch>
        </button>
      </Show>
    </footer>
  </section>
);

const BrewPrep: Component<{
  draft: Accessor<ShotDraft | null>;
  patchDraft: (patch: Partial<ShotDraft>) => void;
  /** Resolved profile for the draft's profileId (fetched by the screen so
   *  it can also build the gateway push). Null = unresolved / missing. */
  profile: Accessor<ProfileRecord | null>;
  profileLoading: Accessor<boolean>;
  loadProfiles?: () => Promise<ProfileRecord[]>;
}> = (p) => {
  const profile = (): ProfileRecord | null => p.profile();
  const curve = createMemo(() => buildProfileCurve(profile()?.profile.steps));
  const hasProfileId = (): boolean => !!p.draft()?.profileId;
  const profileTitle = (): string =>
    (profile()?.profile.title ?? '').trim() || '(untitled)';
  const profileAuthor = (): string =>
    (profile()?.profile.author ?? '').trim();
  const tankTemp = () => profile()?.profile.tank_temperature;

  const [profileDialogOpen, setProfileDialogOpen] = createSignal(false);
  const handleProfileSelect = (id: string) => {
    setProfileDialogOpen(false);
    p.patchDraft({ profileId: id });
  };

  return (
    <>
      {/*
        Profile is the headline of the brew step — it determines the whole
        shot. Title + author header, small target-curve thumbnail, plus a
        Change button to swap the profile *for this shot only*. Below: the
        editable dose / grinder / yield / volume overrides.
      */}
      <section class="prep__profile" data-testid="prep-card-profile">
        <div class="prep__profile-toprow">
          <span class="prep__profile-label">Profile</span>
          <button
            type="button"
            class="btn prep__profile-change"
            data-testid="prep-card-profile-change"
            onClick={() => setProfileDialogOpen(true)}
          >
            {hasProfileId() ? 'Change' : 'Choose'}
          </button>
        </div>
        <Show
          when={hasProfileId()}
          fallback={
            <span
              class="prep__profile-value prep__profile-value--muted"
              data-testid="prep-card-profile-empty"
            >
              No profile selected — tap Choose to pick one for this shot.
            </span>
          }
        >
          <Show
            when={profile()}
            fallback={
              <span
                class="prep__profile-value prep__profile-value--muted"
                data-testid="prep-card-profile-missing"
              >
                {p.profileLoading()
                  ? 'Loading…'
                  : `(missing profile — ${p.draft()?.profileId})`}
              </span>
            }
          >
            <div class="prep__profile-header">
              <span
                class="prep__profile-value"
                data-testid="prep-card-profile-title"
              >
                {profileTitle()}
              </span>
              <Show when={profile()!.isDefault}>
                <span
                  class="profile-row__badge profile-row__badge--default"
                  data-testid="prep-card-profile-default-badge"
                >
                  default
                </span>
              </Show>
            </div>
            <div
              class="prep__profile-meta"
              data-testid="prep-card-profile-meta"
            >
              <Show when={profileAuthor()}>
                <span class="prep__profile-author">by {profileAuthor()}</span>
              </Show>
              <Show
                when={
                  typeof tankTemp() === 'number' && (tankTemp() as number) > 0
                }
              >
                <span class="profile-row__chip">
                  Tank {(tankTemp() as number).toFixed(1)} °C
                </span>
              </Show>
            </div>
            <Show when={!curve().empty}>
              <div
                class="prep__profile-chart"
                data-testid="prep-card-profile-chart-wrap"
              >
                <ProfileCurveChart
                  curve={curve()}
                  width={320}
                  height={96}
                  compact={true}
                  testId="prep-card-profile-chart"
                />
              </div>
            </Show>
          </Show>
        </Show>
      </section>

      <PickerDialog
        open={profileDialogOpen()}
        onClose={() => setProfileDialogOpen(false)}
        title="Choose a profile"
        description="Overrides the profile for this shot only."
        testId="prep-card-profile-dialog"
        maxWidthPx={1100}
      >
        <ProfilePicker
          selectedId={p.draft()?.profileId}
          onSelect={handleProfileSelect}
          onCancel={() => setProfileDialogOpen(false)}
          loadProfiles={p.loadProfiles}
        />
      </PickerDialog>

      <div class="prep__stats">
        <label class="prep__stat" data-testid="prep-card-dose">
          <span class="prep__stat-label">Dose</span>
          <span class="prep__stat-edit">
            <DebouncedNumberField
              value={p.draft()?.doseGrams}
              onCommit={(v) => p.patchDraft({ doseGrams: v })}
              placeholder="—"
              min={0}
              step={0.1}
              ariaLabel="Dose (grams)"
              testId="prep-card-dose-input"
              class="prep__stat-input"
            />
            <span class="prep__stat-unit">g</span>
          </span>
        </label>
        <label class="prep__stat" data-testid="prep-card-grinder">
          <span class="prep__stat-label">Grinder setting</span>
          <span class="prep__stat-edit">
            <DebouncedNumberField
              value={p.draft()?.grinderSetting}
              onCommit={(v) => p.patchDraft({ grinderSetting: v })}
              placeholder="—"
              step={0.1}
              ariaLabel="Grinder setting"
              testId="prep-card-grinder-input"
              class="prep__stat-input"
            />
          </span>
        </label>
        {/* Yield / volume stop targets — always shown + editable. Empty =
            no per-shot stop (the profile's own target drives the shot). */}
        <label class="prep__stat" data-testid="prep-card-target-yield">
          <span class="prep__stat-label">Target yield</span>
          <span class="prep__stat-edit">
            <DebouncedNumberField
              value={p.draft()?.targetYieldGrams}
              onCommit={(v) => p.patchDraft({ targetYieldGrams: v })}
              placeholder="—"
              min={0}
              step={0.1}
              ariaLabel="Target yield (grams)"
              testId="prep-card-target-yield-input"
              class="prep__stat-input"
            />
            <span class="prep__stat-unit">g</span>
          </span>
        </label>
        <label class="prep__stat" data-testid="prep-card-target-volume">
          <span class="prep__stat-label">Target volume</span>
          <span class="prep__stat-edit">
            <DebouncedNumberField
              value={p.draft()?.targetVolumeMl}
              onCommit={(v) => p.patchDraft({ targetVolumeMl: v })}
              placeholder="—"
              min={0}
              step={1}
              ariaLabel="Target volume (millilitres)"
              testId="prep-card-target-volume-input"
              class="prep__stat-input"
            />
            <span class="prep__stat-unit">mL</span>
          </span>
        </label>
      </div>
    </>
  );
};

const fmtStat = (
  n: number | null | undefined,
  digits: number,
  unit: string,
): string =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : `${n.toFixed(digits)}${unit}`;

/** Legend trace declarations for the post-brew chart — mirrors the live
 *  view's legend (minus the dashed-targets entry, which the frozen record
 *  can't supply). Colours come from `chartTraces.ts` so they never drift. */
const RESULT_LEGEND: Array<{
  key: TraceKey;
  name: string;
  color: string;
  suffix?: string;
}> = [
  { key: 'pressure', name: 'pressure', color: TRACE_COLOR.pressure },
  { key: 'flow', name: 'flow', color: TRACE_COLOR.flow },
  { key: 'weightFlow', name: 'weight flow', color: TRACE_COLOR.weightFlow },
  { key: 'weight', name: 'weight', color: TRACE_COLOR.weight, suffix: '÷10' },
  { key: 'mixTemp', name: 'mix temp', color: TRACE_COLOR.mixTemperature, suffix: '÷10' },
];

/**
 * Post-brew result — mirrors the LiveEspressoView skeleton (header with a
 * hero timer, clickable trace legend, big filling chart, readouts row) so
 * the result reads as a natural continuation of the live view. The step
 * bar is hidden at this stage (handled by the parent) to give the chart
 * room. No dashed targets (the frozen record doesn't carry per-frame
 * target data — deferred).
 */
const PostBrewView: Component<{
  onDone: () => void;
  onBrewAgain: () => void;
  fetchLatestShot?: () => Promise<GatewayShotSummary>;
  fetchShot?: (id: string) => Promise<GatewayShotRecord>;
  optimisticShot?: Accessor<GatewayShotRecord | null>;
  updateShot?: (id: string, patch: ShotAnnotationsPatch) => Promise<void>;
  saveDebounceMs?: number;
}> = (p) => {
  // Fetch the persisted espresso shot. Both fetchers resolve to null on
  // failure so a gateway hiccup degrades to the optimistic record (or an
  // empty state) rather than throwing.
  const [summary, { refetch: refetchSummary }] =
    createResource<GatewayShotSummary | null>(() =>
      (p.fetchLatestShot ?? api.shotsLatest)().catch(() => null),
    );
  const [full] = createResource<GatewayShotRecord | null, string>(
    () => summary()?.id,
    (id) => (p.fetchShot ?? api.shotById)(id).catch(() => null),
  );

  // Prefer the optimistic in-memory record until the gateway summary
  // catches up (timestamp ≥ optimistic). Same hand-off as LastShotCard.
  const usingOptimistic = (): boolean => {
    const opt = p.optimisticShot?.();
    if (!opt) return false;
    const s = summary();
    if (!s) return true;
    return Date.parse(s.timestamp) < Date.parse(opt.timestamp);
  };

  // The gateway persists the shot asynchronously on shot-end, so the
  // mount-time /shots/latest can return the *previous* record. While the
  // optimistic stand-in is still on screen, poll until the gateway catches
  // up — this lands the real shot id (the annotation save target) and the
  // real record for the chart. Bounded so a permanently-stale gateway can't
  // spin forever.
  const SUMMARY_POLL_MS = 600;
  let summaryPolls = 0;
  createEffect(() => {
    if (!usingOptimistic() || summaryPolls >= 8) return;
    const t = setTimeout(() => {
      summaryPolls++;
      void refetchSummary();
    }, SUMMARY_POLL_MS);
    onCleanup(() => clearTimeout(t));
  });
  const displayedSummary = (): GatewayShotSummary | null =>
    usingOptimistic() ? p.optimisticShot!() : (summary() ?? null);
  const displayedFull = (): GatewayShotRecord | null =>
    usingOptimistic() ? p.optimisticShot!() : (full() ?? null);

  const stats = createMemo(() =>
    deriveShotStats(displayedSummary(), displayedFull()),
  );
  const hasShot = (): boolean => displayedSummary() !== null;

  // Per-session trace visibility for the legend show/hide. Starts all-on
  // (DEFAULT_TRACE_VISIBILITY) — independent of the live view's prefs to
  // keep the result self-contained.
  const [visibility, setVisibility] =
    createSignal<TraceVisibility>(DEFAULT_TRACE_VISIBILITY);
  const toggleTrace = (key: TraceKey): void => {
    setVisibility({ ...visibility(), [key]: !visibility()[key] });
  };

  // ── Post-shot annotation capture (rating · notes · corrected dose) ──
  const [enjoyment, setEnjoyment] = createSignal<number | null>(null);
  const [notes, setNotes] = createSignal('');
  const [actualDose, setActualDose] = createSignal<number | undefined>();
  const [saveState, setSaveState] = createSignal<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  // Seed the editable fields once, from whichever record paints first. A
  // just-finished shot carries no annotations, so this mostly just defaults
  // the dose to the derived actual-or-target value.
  let seeded = false;
  createEffect(() => {
    const s = displayedSummary();
    if (!s || seeded) return;
    seeded = true;
    const a = s.annotations;
    setEnjoyment(typeof a?.enjoyment === 'number' ? a.enjoyment : null);
    setNotes(a?.espressoNotes ?? '');
    setActualDose(untrack(() => stats().doseG ?? undefined));
  });

  // Persist target: the *real* gateway id, and only once the gateway record
  // is the one on screen. While the optimistic record shows, summary() may
  // still point at the PREVIOUS shot — saving then would annotate the wrong
  // record, so edits are held until the hand-off lands.
  const saveTargetId = (): string | null =>
    usingOptimistic() ? null : summary()?.id ?? null;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  // The dose field is *seeded* from the derived dose (actual ?? target), so
  // only persist it once the user has actually edited it — otherwise a
  // rating-only save would write the target back as the measured actual.
  let doseTouched = false;

  const doSave = async (): Promise<void> => {
    if (!pending) return;
    const id = saveTargetId();
    if (!id) return; // no target yet; stays pending, flushed on hand-off
    pending = false;
    const patch = untrack<ShotAnnotationsPatch>(() => {
      const out: ShotAnnotationsPatch = { espressoNotes: notes().trim() };
      const e = enjoyment();
      if (e != null) out.enjoyment = e;
      const d = actualDose();
      if (doseTouched && d != null) out.actualDoseWeight = d;
      return out;
    });
    setSaveState('saving');
    try {
      await (p.updateShot ?? api.updateShotAnnotations)(id, patch);
      setSaveState('saved');
    } catch {
      pending = true; // let a later edit retry
      setSaveState('error');
    }
  };

  const scheduleSave = (): void => {
    pending = true;
    setSaveState('saving');
    clearTimeout(saveTimer);
    const delay = p.saveDebounceMs ?? 700;
    if (delay <= 0) {
      void doSave();
      return;
    }
    saveTimer = setTimeout(() => void doSave(), delay);
  };

  // Flush held edits the instant a real persist target appears (the
  // optimistic→gateway hand-off).
  createEffect(() => {
    if (saveTargetId() && pending) void doSave();
  });
  onCleanup(() => clearTimeout(saveTimer));

  return (
    <section class="shot-review" data-testid="post-brew-view">
      <div class="shot-review__scroll">
        <Show
          when={hasShot()}
          fallback={
            <div class="post-brew__empty">
              <p class="prep__no-params" data-testid="post-brew-empty">
                <Show when={summary.loading} fallback="No shot data recorded.">
                  Loading shot…
                </Show>
              </p>
            </div>
          }
        >
          <header class="shot-review__head">
            <div class="shot-review__title">
              <span
                class="shot-review__profile"
                data-testid="post-brew-headline"
              >
                {stats().headline}
              </span>
              <Show when={stats().subtitle}>
                <span
                  class="shot-review__subtitle"
                  data-testid="post-brew-subtitle"
                >
                  {stats().subtitle}
                </span>
              </Show>
            </div>
            <span
              class="post-brew__save"
              data-testid="post-brew-save-state"
              data-state={saveState()}
              aria-live="polite"
            >
              <Switch>
                <Match when={saveState() === 'saving'}>Saving…</Match>
                <Match when={saveState() === 'saved'}>Saved ✓</Match>
                <Match when={saveState() === 'error'}>Couldn’t save</Match>
              </Switch>
            </span>
          </header>

          {/* Data · Rate · Notes — three columns; the chart sits below. */}
          <div class="shot-review__cols" data-testid="post-brew-capture">
            <dl class="shot-review__stats" data-testid="post-brew-stats">
              <ReviewStat label="Dose" testId="post-brew-stat-dose">
                <span class="rstat__edit">
                  <DebouncedNumberField
                    value={actualDose()}
                    onCommit={(v) => {
                      setActualDose(v);
                      doseTouched = true;
                      scheduleSave();
                    }}
                    min={0}
                    step={0.1}
                    ariaLabel="Actual dose, grams"
                    testId="post-brew-dose-input"
                    class="rstat__input"
                    debounceMs={p.saveDebounceMs}
                  />
                  <span class="rstat__unit">g</span>
                </span>
              </ReviewStat>
              <ReviewStat
                label="Yield"
                testId="post-brew-stat-yield"
                sub={
                  stats().targetYieldG != null
                    ? `target ${fmtStat(stats().targetYieldG, 1, ' g')}`
                    : undefined
                }
              >
                {fmtStat(stats().yieldG, 1, ' g')}
              </ReviewStat>
              <ReviewStat label="Time" testId="post-brew-time">
                {fmtStat(stats().durationSec, 0, ' s')}
              </ReviewStat>
              <ReviewStat label="Peak P" testId="post-brew-stat-peak-pressure">
                {fmtStat(stats().peakPressureBar, 1, ' bar')}
              </ReviewStat>
              <ReviewStat label="Peak flow" testId="post-brew-stat-peak-flow">
                {fmtStat(stats().peakFlowMlS, 1, ' mL/s')}
              </ReviewStat>
              <ReviewStat
                label="Volume"
                testId="post-brew-stat-volume"
                sub={
                  stats().targetVolumeMl != null
                    ? `target ${fmtStat(stats().targetVolumeMl, 0, ' mL')}`
                    : undefined
                }
              >
                {fmtStat(stats().volumeMl, 0, ' mL')}
              </ReviewStat>
            </dl>

            {/* Divider: objective shot data (left) vs. user feedback (right). */}
            <div class="shot-review__divider" aria-hidden="true" />

            <div class="review-col review-col--rate">
              <span class="review-field__label">Rate</span>
              <div class="rating">
                <ShotRatingFace value={enjoyment()} />
                <input
                  type="range"
                  class="rating__slider"
                  min="0"
                  max="100"
                  step="1"
                  value={enjoyment() ?? 50}
                  classList={{ 'rating__slider--unset': enjoyment() == null }}
                  aria-label="Enjoyment rating, 0 to 100"
                  data-testid="post-brew-rating"
                  onInput={(e) => {
                    setEnjoyment(Number(e.currentTarget.value));
                    scheduleSave();
                  }}
                />
                <div class="rating__value" data-testid="post-brew-rating-value">
                  <Show when={enjoyment() != null} fallback="Drag to rate">
                    <span class="rating__num">{enjoyment()}</span>
                    <span class="rating__den"> / 100</span>
                  </Show>
                </div>
              </div>
            </div>

            <div class="review-col review-col--notes">
              <label class="review-field">
                <span class="review-field__label">Notes</span>
                <textarea
                  class="post-brew__notes"
                  rows="4"
                  placeholder="Bright, jammy, a little sharp on the finish…"
                  data-testid="post-brew-notes"
                  value={notes()}
                  onInput={(e) => {
                    setNotes(e.currentTarget.value);
                    scheduleSave();
                  }}
                />
              </label>
              <button
                type="button"
                class="btn shot-review__viz"
                data-testid="post-brew-visualizer"
                disabled
                title="Coming soon"
              >
                Upload to Visualizer
              </button>
            </div>
          </div>

          {/* Supporting curve — full width, below the data; grows with the
              scroll area. */}
          <div class="shot-review__chart-wrap">
            <ul
              class="live-view__legend shot-review__legend"
              aria-label="Chart legend"
              data-testid="post-brew-legend"
            >
              <For each={RESULT_LEGEND}>
                {(item) => {
                  const isOn = createMemo(() => visibility()[item.key]);
                  return (
                    <li>
                      <button
                        type="button"
                        class="legend-item"
                        classList={{ 'legend-item--hidden': !isOn() }}
                        aria-pressed={isOn()}
                        aria-label={`Toggle ${item.name} trace`}
                        data-testid={`post-brew-legend-${item.key}`}
                        onClick={() => toggleTrace(item.key)}
                      >
                        <span
                          class="legend-swatch"
                          style={{ background: item.color }}
                          aria-hidden="true"
                        />
                        <span class="legend-label">{item.name}</span>
                        <Show when={item.suffix}>
                          <span class="legend-suffix">{item.suffix}</span>
                        </Show>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
            <div class="shot-review__chart" data-testid="post-brew-chart">
              <ShotMiniChart
                shot={displayedFull}
                fill={true}
                showAxes={true}
                visibility={visibility}
              />
            </div>
          </div>
        </Show>
      </div>

      <footer class="prep__action prep__action--row post-brew__actions">
        <button
          type="button"
          class="btn prep__secondary"
          data-testid="post-brew-brew-again"
          onClick={p.onBrewAgain}
        >
          Brew again
        </button>
        <button
          type="button"
          class="btn btn--primary prep__start"
          data-testid="post-brew-done"
          onClick={p.onDone}
        >
          Done
        </button>
      </footer>
    </section>
  );
};

/** A compact stat row on the Shot Review rail: a small label with its value
 *  (string or custom content, e.g. the editable dose field) and an optional
 *  muted target sub-line — actual and target shown as separate values, never
 *  an `actual/target` fraction (per the agreed result-screen treatment). */
const ReviewStat: Component<{
  label: string;
  testId: string;
  sub?: string;
  children: JSX.Element;
}> = (p) => (
  <div class="rstat" data-testid={p.testId}>
    <dt class="rstat__label">{p.label}</dt>
    <dd class="rstat__value">{p.children}</dd>
    <Show when={p.sub}>
      <dd class="rstat__sub" data-testid={`${p.testId}-target`}>{p.sub}</dd>
    </Show>
  </div>
);
