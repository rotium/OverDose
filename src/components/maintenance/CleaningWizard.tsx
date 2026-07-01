import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import type { Cleaning } from '../../domain';
import type { MachineSnapshot, MachineState } from '../../snapshot';
import type { WsStream } from '../../streams';
import { buildWizard, wizardFinishLines, type WizardPhase } from './cleaningWizard';
import { log } from '../../debugLog';

type PhaseStatus = 'pending' | 'requested' | 'running' | 'done';

export interface CleaningWizardProps {
  cleaning: Cleaning;
  machineStream: () => WsStream<MachineSnapshot>;
  requestState: (state: MachineState) => Promise<void>;
  /** Capture the current gateway workflow (opaque token) so a coffee-side
   *  profile run can be restored afterward. Called once, before the first
   *  profile run. */
  captureWorkflow: () => Promise<unknown>;
  /** Restore a previously-captured workflow (coffee-side cleanup). */
  restoreWorkflow: (saved: unknown) => Promise<void>;
  /** Load the cleaning profile for a coffee-side run (resolve + setWorkflow).
   *  Returns the profile's total run seconds (for the progress bar), or
   *  undefined if unknown. */
  loadCleaningProfile: (profileId?: string) => Promise<number | undefined>;
  /** Called when the wizard finishes — stamps lastDoneAt + closes. */
  onComplete: (cleaning: Cleaning) => void;
  /** Called on close/abort without completing. */
  onExit: () => void;
  /** Fired when a soak timer elapses (App plays a sound cue if enabled). */
  onTimerElapsed?: () => void;
}

/**
 * Cleaning runtime — walks a cleaning's wizard phases one at a time. Instruction
 * phases advance on Next; run phases request a machine state and watch the
 * snapshot to detect enter → finish (the RecipeBrewScreen monitor pattern,
 * GHC-safe). Full-screen, launched from Maintenance → Run.
 *
 * Coffee-side profile runs (with workflow save/restore) and steam-wand steam
 * runs are placeholders for now; see docs/plans/cleaning-feature.md.
 */
export const CleaningWizard: Component<CleaningWizardProps> = (p) => {
  const phases = buildWizard(p.cleaning);
  // Deferred "finish" actions from soak/manual steps — shown on the closing
  // step in reverse step order (un-stack what you set up).
  const finishLines = wizardFinishLines(p.cleaning);
  const [statuses, setStatuses] = createSignal<PhaseStatus[]>(
    phases.map(() => 'pending'),
  );
  const machine = p.machineStream();

  const currentIdx = createMemo<number>(() => {
    const ss = statuses();
    const idx = ss.findIndex((s) => s !== 'done');
    return idx === -1 ? ss.length : idx;
  });
  const finished = (): boolean => currentIdx() === phases.length;
  const current = (): WizardPhase | undefined => phases[currentIdx()];
  const startsTimerOf = (phase: WizardPhase | undefined): number | undefined =>
    phase?.kind === 'instruction' ? phase.startsTimerSec : undefined;

  const setStatus = (idx: number, next: PhaseStatus) =>
    setStatuses((prev) => {
      if (prev[idx] === next) return prev;
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });

  // Elapsed clock for the active run phase.
  const [nowMs, setNowMs] = createSignal(0);
  const [runStartMs, setRunStartMs] = createSignal(0);
  const [runTotalSec, setRunTotalSec] = createSignal<number | undefined>(undefined);
  const progress = (): number | undefined => {
    const total = runTotalSec();
    return total ? Math.min(1, elapsedSec() / total) : undefined;
  };
  onMount(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500);
    onCleanup(() => clearInterval(t));
  });
  const elapsedSec = (): number =>
    runStartMs() === 0 ? 0 : Math.max(0, Math.floor((nowMs() - runStartMs()) / 1000));

  // A single global soak timer, started when the first soak step is confirmed
  // and extended (never shortened) by later soaks: end = max(end, now + sec).
  // It runs in the background across all later steps; chimes once on elapse.
  // The deferred finish actions are done on the closing step after it chimes.
  const [timerEndMs, setTimerEndMs] = createSignal(0);
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const clearSoakTimer = () => {
    if (timerHandle !== undefined) {
      clearTimeout(timerHandle);
      timerHandle = undefined;
    }
    setTimerEndMs(0);
  };
  onCleanup(clearSoakTimer);
  const extendSoakTimer = (sec: number) => {
    const end = Math.max(timerEndMs(), Date.now() + sec * 1000);
    setTimerEndMs(end);
    if (timerHandle !== undefined) clearTimeout(timerHandle);
    timerHandle = setTimeout(() => {
      timerHandle = undefined;
      p.onTimerElapsed?.();
    }, Math.max(0, end - Date.now()));
  };
  const timerActive = (): boolean => timerEndMs() > 0;
  const timerRemainingSec = (): number => {
    const end = timerEndMs();
    return end === 0 ? 0 : Math.max(0, Math.ceil((end - nowMs()) / 1000));
  };
  const formatMMSS = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Run monitor — mirrors RecipeBrewScreen: enter target ⇒ running; leave ⇒ done.
  createEffect(() => {
    const snap = machine.latest();
    if (!snap) return;
    const idx = currentIdx();
    const phase = phases[idx];
    if (!phase || phase.kind !== 'run') return;
    const ss = statuses();
    const cur = snap.state.state;
    if ((ss[idx] === 'requested' || ss[idx] === 'pending') && cur === phase.target) {
      setRunStartMs(Date.now());
      setStatus(idx, 'running');
    } else if (ss[idx] === 'running' && cur !== phase.target) {
      clearRunTimer();
      setRunStartMs(0);
      setRunTotalSec(undefined);
      setStatus(idx, 'done');
    }
  });

  // The user's workflow, captured before the first coffee-side profile run and
  // restored once at the end — so a profile run never leaves the cleaning
  // profile loaded as the active brewing profile (and repeats don't re-save).
  let savedWorkflow: unknown = null;
  let hasSaved = false;
  // Flush is bounded by the wizard (the machine doesn't reliably auto-stop it):
  // we requestState('idle') after the step's configured duration.
  let runStopTimer: ReturnType<typeof setTimeout> | undefined;
  const clearRunTimer = () => {
    if (runStopTimer !== undefined) {
      clearTimeout(runStopTimer);
      runStopTimer = undefined;
    }
  };
  onCleanup(clearRunTimer);
  const restoreIfNeeded = async () => {
    if (!hasSaved) return;
    hasSaved = false;
    const w = savedWorkflow;
    savedWorkflow = null;
    try {
      await p.restoreWorkflow(w);
    } catch (e) {
      log.warn('clean', 'restore workflow failed', e);
    }
  };

  const startRun = async () => {
    const idx = currentIdx();
    const phase = phases[idx];
    if (!phase || phase.kind !== 'run') return;
    setStatus(idx, 'requested');
    try {
      if (phase.op.type === 'profile') {
        if (!hasSaved) {
          savedWorkflow = await p.captureWorkflow();
          hasSaved = true;
        }
        const total = await p.loadCleaningProfile(phase.op.profileId);
        setRunTotalSec(total);
        await p.requestState('espresso');
      } else {
        await p.requestState(phase.target);
        // flush + steam carry a duration — bound them ourselves (the machine
        // doesn't reliably auto-stop a flush, and we want a deterministic time).
        if (phase.durationSec) {
          setRunTotalSec(phase.durationSec);
          runStopTimer = setTimeout(() => {
            runStopTimer = undefined;
            p.requestState('idle').catch((e) =>
              log.warn('clean', 'run stop failed', e),
            );
          }, phase.durationSec * 1000);
        }
      }
    } catch (e) {
      log.error('clean', 'cleaning run start failed', e);
      setStatus(idx, 'pending');
    }
  };

  const stopRun = () => {
    clearRunTimer();
    p.requestState('idle').catch((e) => log.warn('clean', 'stop failed', e));
  };

  const next = () => {
    const phase = current();
    if (phase?.kind === 'instruction' && phase.startsTimerSec) {
      extendSoakTimer(phase.startsTimerSec);
    }
    setStatus(currentIdx(), 'done');
  };

  const complete = async () => {
    await restoreIfNeeded();
    p.onComplete(p.cleaning);
  };

  const handleExit = async () => {
    clearRunTimer();
    const idx = currentIdx();
    const phase = phases[idx];
    const st = statuses()[idx];
    if (phase?.kind === 'run' && (st === 'requested' || st === 'running')) {
      p.requestState('idle').catch((e) => log.warn('clean', 'stop failed', e));
    }
    await restoreIfNeeded();
    p.onExit();
  };

  const status = (): PhaseStatus => statuses()[currentIdx()] ?? 'pending';

  return (
    <div class="settings" data-testid="cleaning-wizard">
      <header class="settings__header">
        <button
          type="button"
          class="icon-btn"
          aria-label="Close"
          data-testid="wizard-close"
          onClick={() => void handleExit()}
        >
          ×
        </button>
        <h1 class="settings__title">{p.cleaning.name}</h1>
        <span class="cleaning-wizard__counter" data-testid="wizard-counter">
          <Show when={!finished()}>
            {currentIdx() + 1} / {phases.length}
          </Show>
        </span>
      </header>

      <div class="settings__content cleaning-wizard__body">
        <Show when={timerActive()}>
          <div class="cleaning-wizard__soak-float">
            <div class="cleaning-wizard__soak" data-testid="wizard-soak">
              <Show when={timerRemainingSec() > 0} fallback={<>Soak ready — finish up below</>}>
                Soaking… {formatMMSS(timerRemainingSec())} left — we’ll chime when it’s ready
              </Show>
            </div>
          </div>
        </Show>
        <Switch>
          <Match when={finished()}>
            <div class="cleaning-wizard__phase" data-testid="wizard-done">
              <div class="cleaning-wizard__phase-title">
                <h2 class="cleaning-wizard__title">
                  <Show when={finishLines.length > 0} fallback={<>All done</>}>
                    Finish up
                  </Show>
                </h2>
              </div>
              <div class="cleaning-wizard__phase-content">
                <Show
                  when={finishLines.length > 0}
                  fallback={
                    <p class="settings-help">"{p.cleaning.name}" complete.</p>
                  }
                >
                  <Show
                    when={timerRemainingSec() > 0}
                    fallback={
                      <p class="settings-help">The soaks are ready — finish these:</p>
                    }
                  >
                    <p class="cleaning-wizard__status" data-testid="wizard-finish-timer">
                      Soaking… {formatMMSS(timerRemainingSec())} left. When it chimes:
                    </p>
                  </Show>
                  <ul class="cleaning-wizard__lines" data-testid="wizard-finish-lines">
                    <For each={finishLines}>{(l) => <li>{l}</li>}</For>
                  </ul>
                </Show>
              </div>
            </div>
          </Match>
          <Match when={current()?.kind === 'instruction'}>
            <div class="cleaning-wizard__phase" data-testid="wizard-instruction">
              <div class="cleaning-wizard__phase-title">
                <h2 class="cleaning-wizard__title">{current()!.title}</h2>
              </div>
              <div class="cleaning-wizard__phase-content">
                <ul class="cleaning-wizard__lines">
                  <For each={current()!.lines}>{(l) => <li>{l}</li>}</For>
                </ul>
                <Show when={startsTimerOf(current())}>
                  {(secs) => (
                    <p class="settings-help" data-testid="wizard-timer-hint">
                      Leave it to soak — Next starts a ~{Math.round(secs() / 60)}-min
                      timer and you can carry on; we’ll chime when it’s ready.
                    </p>
                  )}
                </Show>
              </div>
            </div>
          </Match>
          <Match when={current()?.kind === 'run'}>
            <div class="cleaning-wizard__phase" data-testid="wizard-run">
              <div class="cleaning-wizard__phase-title">
                <h2 class="cleaning-wizard__title">{current()!.title}</h2>
              </div>
              <div class="cleaning-wizard__phase-content">
                <ul class="cleaning-wizard__lines">
                  <For each={current()!.lines}>{(l) => <li>{l}</li>}</For>
                </ul>
                <div class="cleaning-wizard__phase-mid">
                  <Show when={status() === 'requested' || status() === 'running'}>
                    <p class="cleaning-wizard__status" data-testid="wizard-running">
                      <Show when={status() === 'running'} fallback={<>Starting…</>}>
                        Running… {elapsedSec()}s
                      </Show>
                    </p>
                    <Show when={status() === 'running' && progress() !== undefined}>
                      <div
                        class="cleaning-wizard__progress"
                        data-testid="wizard-progress"
                        role="progressbar"
                      >
                        <div
                          class="cleaning-wizard__progress-fill"
                          style={{ width: `${Math.round(progress()! * 100)}%` }}
                        />
                      </div>
                    </Show>
                  </Show>
                </div>
              </div>
            </div>
          </Match>
        </Switch>
      </div>

      {/* Single full-width pinned action bar — same as the brew prep bar, so
          the "Start" footer is identical across screens. The button it shows
          depends on the current phase. */}
      <div class="cleaning-wizard__actionbar">
        <Switch>
          <Match when={finished()}>
            <button
              type="button"
              class="btn btn--primary cleaning-wizard__btn"
              data-testid="wizard-finish"
              onClick={() => void complete()}
            >
              Done
            </button>
          </Match>
          <Match when={current()?.kind === 'instruction'}>
            <button
              type="button"
              class="btn btn--primary cleaning-wizard__btn"
              data-testid="wizard-next"
              onClick={next}
            >
              {startsTimerOf(current())
                ? 'Start soak'
                : currentIdx() === phases.length - 1
                  ? 'Finish'
                  : 'Next'}
            </button>
          </Match>
          <Match when={current()?.kind === 'run'}>
            <Show
              when={status() === 'pending'}
              fallback={
                <button
                  type="button"
                  class="btn cleaning-wizard__btn"
                  data-testid="wizard-stop"
                  onClick={stopRun}
                >
                  Stop
                </button>
              }
            >
              <button
                type="button"
                class="btn btn--primary cleaning-wizard__btn"
                data-testid="wizard-start"
                onClick={startRun}
              >
                Start
              </button>
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  );
};
