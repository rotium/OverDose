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
                recipe={recipe}
                status={() => statuses()[currentIdx()]!}
                onStart={startCurrentStep}
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
  recipe: Accessor<Recipe | null | undefined>;
  status: Accessor<StepStatus>;
  onStart: () => void;
}> = (p) => (
  <section class="prep" data-testid="prep-card">
    <header class="prep__heading">
      <span class="prep__eyebrow">Prep for</span>
      <h2 class="prep__title">{formatStepType(p.step().type)}</h2>
    </header>

    <div class="prep__body">
      <Switch>
        <Match when={p.step().type === 'brew'}>
          <BrewPrep recipe={p.recipe} />
        </Match>
        <Match when={p.step().type === 'steam'}>
          <SteamPrep step={p.step} />
        </Match>
        <Match
          when={p.step().type === 'water' || p.step().type === 'flush'}
        >
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
  recipe: Accessor<Recipe | null | undefined>;
}> = (p) => (
  <>
    {/*
      Profile is the headline of the brew step — it determines the whole
      shot. Featured on its own with the largest weight; dose and grind
      sit beneath as supporting readouts. Profile library is still TODO,
      so the value renders as a placeholder.
    */}
    <section class="prep__profile" data-testid="prep-card-profile">
      <span class="prep__profile-label">Profile</span>
      <span class="prep__profile-value">Profile library not built yet</span>
    </section>
    <div class="prep__stats">
      <div class="prep__stat">
        <span class="prep__stat-label">Dose</span>
        <span class="prep__stat-value">
          <Show
            when={p.recipe()?.doseGrams !== undefined}
            fallback={<em>—</em>}
          >
            {p.recipe()!.doseGrams}
            <span class="prep__stat-unit">g</span>
          </Show>
        </span>
      </div>
      <div class="prep__stat">
        <span class="prep__stat-label">Grinder setting</span>
        <span class="prep__stat-value">
          <Show
            when={p.recipe()?.grinderSetting !== undefined}
            fallback={<em>—</em>}
          >
            {p.recipe()!.grinderSetting}
          </Show>
        </span>
      </div>
    </div>
  </>
);

const SteamPrep: Component<{ step: Accessor<BeverageStep> }> = (p) => {
  const cfg = () =>
    p.step().type === 'steam'
      ? (p.step().config as { autoPurgeTimeSec?: number })
      : null;
  const auto = () => (cfg()?.autoPurgeTimeSec ?? 0) > 0;
  return (
    <section class="prep__profile" data-testid="prep-card-steam">
      <span class="prep__profile-label">Purge</span>
      <span class="prep__profile-value">
        <Show
          when={auto()}
          fallback={
            <>Manual — press the purge button on the machine when ready.</>
          }
        >
          Auto — {cfg()!.autoPurgeTimeSec}s after steam ends.
        </Show>
      </span>
    </section>
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
