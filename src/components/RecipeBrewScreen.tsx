import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type Accessor,
  type Component,
} from 'solid-js';
import {
  formatStepType,
  type Beverage,
  type BeverageStep,
  type Recipe,
  type StepType,
} from '../domain';
import { useRepositories } from '../RepositoriesContext';
import type { MachineSnapshot, MachineState } from '../snapshot';
import type { WsStream } from '../streams';
import { api, type ProfileRecord, type WorkflowUpdate } from '../api';
import { buildProfileCurve } from '../profile/curve';
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
  /** Returns the user to Home; called by the back arrow and Done. */
  onExit: () => void;
  /** Streams the machine snapshot — used to detect step-end transitions. */
  machineStream: () => WsStream<MachineSnapshot>;
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

interface BrewBundle {
  recipe: Recipe | null;
  beverage: Beverage | null;
}

export const RecipeBrewScreen: Component<RecipeBrewScreenProps> = (p) => {
  const repos = useRepositories();
  const machine = p.machineStream();

  // Combined fetch so the header + body don't render a half-loaded state
  // (recipe arrived but beverage still pending — the previous two-resource
  // setup was racy in jsdom even though it usually settled fast in browsers).
  const [bundle] = createResource<BrewBundle, string>(
    () => p.recipeId,
    async (id): Promise<BrewBundle> => {
      const recipe = await repos.recipes.get(id);
      if (!recipe) return { recipe: null, beverage: null };
      const beverage = await repos.beverages.get(recipe.beverageId);
      return { recipe, beverage };
    },
  );

  const recipe = (): Recipe | null | undefined =>
    bundle.loading ? undefined : (bundle()?.recipe ?? null);
  const beverage = (): Beverage | null | undefined =>
    bundle.loading ? undefined : (bundle()?.beverage ?? null);

  const steps = (): BeverageStep[] => beverage()?.steps ?? [];

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

  // Per-step status — defaults all to 'pending' until the recipe + beverage
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
      <BrewHeader recipe={recipe} beverage={beverage} onExit={p.onExit} />

      <Switch>
        <Match when={bundle.loading}>
          <p class="muted brew-screen__loading">loading recipe…</p>
        </Match>
        <Match when={recipe() === null}>
          <p class="muted brew-screen__loading" role="alert">
            recipe not found
          </p>
        </Match>
        <Match when={beverage() === null}>
          <p class="muted brew-screen__loading" role="alert">
            parent beverage not found
          </p>
        </Match>
        <Match when={steps().length === 0}>
          <p class="muted brew-screen__loading">
            this beverage has no steps yet
          </p>
        </Match>
        <Match when={recipe() && beverage() && steps().length > 0}>
          <StepBar
            steps={steps}
            statuses={statuses}
            currentIdx={currentIdx}
            onJump={jumpToStep}
          />

          <section class="brew-screen__body">
            <Show
              when={!isFinished()}
              fallback={
                <PostBrewView
                  onDone={p.onExit}
                  onBrewAgain={resetForBrewAgain}
                />
              }
            >
              <PrepCard
                step={() => steps()[currentIdx()]!}
                draft={draft}
                patchDraft={patchDraft}
                status={() => statuses()[currentIdx()]!}
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
  beverage: Accessor<Beverage | null | undefined>;
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
        class="brew-screen__beverage-name"
        data-testid="brew-beverage-name"
      >
        {p.beverage()?.name ?? '…'}
      </span>
    </h1>
  </header>
);

const StepBar: Component<{
  steps: Accessor<BeverageStep[]>;
  statuses: Accessor<StepStatus[]>;
  currentIdx: Accessor<number>;
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
        return (
          <li
            class="step-bar__item"
            data-variant={variant()}
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
                {variant() === 'done'
                  ? '✓'
                  : variant() === 'skipped'
                    ? '–'
                    : i() + 1}
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
  step: Accessor<BeverageStep>;
  draft: Accessor<ShotDraft | null>;
  patchDraft: (patch: Partial<ShotDraft>) => void;
  status: Accessor<StepStatus>;
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
          onClick={p.onStart}
        >
          Start {formatStepType(p.step().type).toLowerCase()}
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

const PostBrewView: Component<{
  onDone: () => void;
  onBrewAgain: () => void;
}> = (p) => (
  <section class="prep" data-testid="post-brew-view">
    <header class="prep__heading">
      <span class="prep__eyebrow">Result</span>
      <h2 class="prep__title">Brew complete</h2>
    </header>
    <div class="prep__body">
      <p class="prep__no-params">
        Result summary (yield, time, peak pressure, mini chart) will land
        here in the next pass — for now you can repeat the recipe or
        return Home.
      </p>
    </div>
    <footer class="prep__action prep__action--row">
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
