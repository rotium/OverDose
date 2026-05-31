# Steam: substate re-anchor + purge-mode setting (a/b/c)

Status: implemented (pending hardware verification) · 2026-05-31

Both parts built on branch `feature/steam-purge-substate-reanchor`. Part 1
(substate re-anchor) verified on hardware by the user — counter freezes at stop,
visuals improved. Part 2 (a/b/c purge strategy + write-through) built and
unit-tested (640 pass, tsc + vite build clean); needs hardware confirmation that
default `firmware`/mode-0 makes a manual stop purge immediately, and that the
autoFlush/manual second-idle fires the purge.

## Why

Three steam bugs reported on a real DE1 (machine running `steamPurgeMode = 1`,
i.e. firmware two-tap stop). From a debug-log trace + user observations they all
turned out to share **one root cause**.

Observed:
1. Short steam (≲10 s) → no purge at all.
2. Longer steam: completing the timer → purge works; stopping early → steam
   stops but **no purge until the UI countdown reaches 0**, then it purges.
3. App STOP button vs physical steam button → identical behaviour.
4. (From the trace) the auto-stop fires too early on short durations because it
   counts warm-up time; sometimes cuts steam to ~0 s.
5. (From the trace) the UI countdown keeps running after a manual stop.

### The firmware model we reverse-engineered

- The purge is **not** a top-level `airPurge` state on this firmware/gateway.
  It surfaces as parent state **`steam` + substate `pouringDone`** for ~5–6 s,
  then `idle`. `MachineState 'airPurge'` never appears in any trace — so our
  current `airPurge`-based purge detection is **dead code**.
- In **two-tap mode (`steamPurgeMode = 1`)** the purge requires **two stop
  events**: the first stops steam flow and *parks* (`steam/pouringDone` or
  `steam/idle`, parent stays `steam`); the **second** `idle` triggers the purge
  (`→ idle`). The gateway flattens the firmware `puffing`/`pausedSteam`
  substates to `idle`, so the park reads as `steam/idle` or `steam/pouringDone`.
- Mapping the observations onto "two events":
  - Complete the timer → firmware self-stop is event 1 (we see `steam/idle`
    before our autostop), our autostop `idle` is event 2 → purge. ✓
  - Stop early → your stop is event 1, our autostop at the target time is
    event 2 → "purges when the countdown hits 0." ✓
  - Short duration → the autostop (counting from session start incl. warm-up)
    fires so early it becomes the *only* event → never a second event → no
    purge. ✓
  - App vs physical → irrelevant; the deciding event is always our autostop. ✓

### The single root cause

The steam session is driven by the **`steam` parent state + a wall-clock
timer**. It should be driven by the **`pouring` substate**, which is the only
signal that says steam is actually flowing:

| substate (under parent `steam`) | meaning |
|---|---|
| `preparingForShot` | warming up (no steam yet) |
| `pouring` | actively steaming |
| `pouringDone` / `idle` | steam stopped — parked / purging |

One re-anchoring fixes the counter, the warm-up timing, the dead purge UI, and
gives us the exact park-detection signal needed to drive the purge.

## Design

Two parts:

- **Part 1 — re-anchor the steam session on the `pouring` substate.** Pure
  correctness; applies regardless of purge mode.
- **Part 2 — steam purge-mode setting (a/b/c)** for *how* the purge is
  triggered, with firmware write-through. Default = (a) firmware purge / mode 0,
  which by itself makes the purge deterministic for everyone.

### Part 1 — substate re-anchor

Authoritative phase lives in `LiveShotContext` (it already tracks `prevSubstate`
and owns `opPhase`/`opStartedAtMs`). `deriveActivity` is updated for consistency
but the live UI reads `opPhase`.

Steam session phase, derived from `(state, substate)` + history:

```
heating   : state==='steam' && substate==='preparingForShot'
steaming  : state==='steam' && substate==='pouring'
purging   : state==='steam' && substate!=='pouring' && we have seen 'pouring'
            (i.e. pouringDone | idle park after real steaming)
done      : state!=='steam'  (→ idle)
```

Changes in `LiveShotContext` (`createEffect` at ~line 186, op-session block
~245–323, steam time-stop effect ~362–390):

- Add `steamPouringStartMs` (epoch ms of the **first** `steam/pouring` frame in
  the session; `0` until steaming actually starts). This is the clock origin
  for steam — **not** `opStartedAtMs` (which stays the session/warm-up start so
  the readouts "open duration" is unchanged).
- Set `opPhase` from the table above instead of `state === 'airPurge'`:
  - `steam`+`pouring` → `'steaming'`
  - `steam`+ (left `pouring`, having seen it) → `'purging'`
  - keep `'heating'` for `preparingForShot` (LiveSteamView already gates the
    countdown on a target; heating shows temp climb).
- **Auto-stop re-anchor** (`steam time-stop` effect): compute
  `elapsedSec = (snap.ts − steamPouringStartMs)/1000` and only run while
  `opPhase()==='steaming'` (substate `pouring`). Skip entirely until
  `steamPouringStartMs > 0`. This fixes Bug 4 (no warm-up counted) and matches
  the firmware's own `TargetSteamLength` semantics. Keep the single-fire
  `steamStopFired` latch.
- Reset `steamPouringStartMs` to `0` on session end (with the other resets).

Changes in `LiveSteamView` (`elapsedSec`/`heroTimer` ~160–212; `phase` prop
already exists):

- Drive `elapsedSec` off the new pouring origin (via a prop, see below), so the
  countdown freezes the moment steaming stops. When `phase()==='purging'` the
  hero already swaps to the "Purging steam wand…" indicator — that now actually
  fires (fixes Bug 5 + the dead UI). The `±s` adjusters + ready chip already
  hide while purging.
- Add `startedAtMs` semantics note: keep the existing `startedAtMs` for the
  readouts row (open-duration), add a `steamingStartedAtMs` (or pass the
  pouring origin) for the countdown. Simplest: pass the pouring origin as the
  countdown clock and leave the readouts on the session origin.

Changes in `machineActivity.deriveActivity` (steam case ~116–124):

- `steam`+`pouring` → `phase:'steaming'`; `steam`+`pouringDone`/`idle` →
  `phase:'purging'`; `steam`+`preparingForShot` → `phase:'heating'`.
- Leave the `airPurge` case as a harmless fallback. Note in the comment that on
  current firmware the purge surfaces as `steam/pouringDone`, not `airPurge`.
- Caveat: `deriveActivity` is single-snapshot and can't see history, so a cold
  subscribe landing on `steam/idle` would read as `purging`. Acceptable — the
  live UI uses the stateful `opPhase`; `deriveActivity` only feeds the
  dashboard pill + debug `state` line.

`RecipeBrewScreen` step advancement (~343–359) needs **no change**: the step
completes when parent state leaves `steam` (→ idle after the purge). It
correctly waits through park + purge. In manual mode (c) it waits for the user's
Purge tap, which is intended.

### Part 2 — purge-mode setting (a/b/c)

A skin preference governs *how* the purge fires. Named distinctly from the
firmware field to avoid confusion:

```ts
// prefs.ts
export type SteamPurgeStrategy = 'firmware' | 'autoFlush' | 'manual';
export const DEFAULT_STEAM_PURGE_STRATEGY: SteamPurgeStrategy = 'firmware';
export const DEFAULT_STEAM_AUTO_FLUSH_SEC = 3; // dwell for 'autoFlush'
```

| Strategy | UI label | firmware `steamPurgeMode` | App behaviour |
|---|---|---|---|
| `firmware` (a) | "Machine auto-purge" | `0` | one `idle` = stop **and** purge (firmware does the ~5 s purge). Default. |
| `autoFlush` (b) | "Auto-purge after delay" | `1` | stop `idle` → park → wait `steamAutoFlushSec` → `idle` (purge) |
| `manual` (c) | "Manual purge" | `1` | stop `idle` → park → show **Purge** button → `idle` (purge) |

**Firmware write-through** (same pattern as `refillLevel` water-thresholds):
- On machine connect/ready and whenever the pref changes, write
  `steamPurgeMode` (0 for `firmware`, 1 for `autoFlush`/`manual`) via
  `api.updateMachineSettings({ steamPurgeMode })`. Skin pref is the source of
  truth; reconcile on connect.
- Read current `steamPurgeMode` once for display, but the pref wins.

**Purge orchestration** in `LiveShotContext` (the steam-session block). Separate
"stop steaming" from "purge":
- *stop steaming* = `requestState('idle')` — in mode 0 it stops+purges; in mode
  1 it parks. Only sent if **still steaming** (`opPhase()==='steaming'`); if the
  firmware already self-stopped (we see the park directly), skip it.
- *purge* (mode 1 only, one-shot `purgeFired` latch), triggered on detecting the
  park (`opPhase` transitions `steaming → purging`):
  - `firmware`: no-op (already stops+purges).
  - `autoFlush`: `setTimeout(steamAutoFlushSec)` → `requestState('idle')`.
  - `manual`: wait for the Purge button → `requestState('idle')`.

Notes:
- A second `idle` in mode 0 / during `pouringDone` is harmless, but gate behind
  the latch + mode so we don't spam the gateway.
- The dwell timer must be cancelled if the session ends first (state → idle).
- All purge/stop commands go through `api.requestState` (already logged as
  `cmd → requestState(idle)`), so traces stay readable.

**UI:**
- `MachineTab` "Steam" section (`MachineTab.tsx` ~96): add a 3-way selector
  (segmented control) for `SteamPurgeStrategy`, and a dwell number field
  (`DebouncedNumberField`, seconds) shown only when `autoFlush`. Copy should
  note that `autoFlush`/`manual` set the machine to two-tap, which also changes
  the physical steam button to two presses.
- `LiveSteamView`: when `phase()==='purging'`:
  - `autoFlush` → "Purging in {n}s" countdown (or just the existing purging
    indicator; dwell is short).
  - `manual` → a **Purge wand** button that fires the purge `idle`; keep STOP as
    an escape.
  - `firmware` → existing "Purging steam wand…" indicator.

## Files touched

- `src/prefs.ts` — `SteamPurgeStrategy`, defaults.
- `src/UserPrefsContext.tsx` — persist `steamPurgeStrategy`, `steamAutoFlushSec`
  (+ `PersistedPrefs` fields, accessors, setters, save object).
- `src/LiveShotContext.tsx` — `steamPouringStartMs`; substate-driven `opPhase`;
  re-anchored auto-stop; stop/purge orchestration + `purgeFired` latch + dwell
  timer; pass purge strategy/dwell in (props or via prefs).
- `src/components/operations/LiveSteamView.tsx` — countdown off pouring origin;
  purge UI per strategy (manual Purge button, autoFlush dwell text).
- `src/machineActivity.ts` — steam phase from `pouring` substate.
- `src/components/settings/MachineTab.tsx` — strategy selector + dwell field +
  write-through.
- `src/api.ts` — none expected (`updateMachineSettings`/`requestState` exist;
  `MachineSettingsSnapshot.steamPurgeMode` already typed).
- Wiring of the write-through on connect — `App.tsx` (where machine
  ready/connect is observed) or wherever water-threshold write-through lives;
  mirror that.

## Edge cases / risks

- **Firmware self-stop vs skin stop race** at the target time: gate the skin
  stop-idle on `opPhase()==='steaming'` so we don't double-send; the purge latch
  is separate.
- **`steam/idle` ambiguity** in `deriveActivity` (single-snapshot) — accepted;
  live UI uses stateful `opPhase`.
- **Sim**: `MockDe1` goes `steam → idle` directly and never emits `pouring`
  dwell the same way. Verify the re-anchor still advances steps in sim (the
  auto-stop must still fire — guard so that if `pouring` is never seen but the
  session is active with a target, we still stop; or accept sim uses the
  session origin). Decide during impl; add/adjust a `LiveShotContext` test.
- **Mode-1 physical-button stop with strategy `firmware`** can't happen by
  construction (firmware mode is 0 then). If a user manually flips the MMR
  elsewhere, the write-through on next connect corrects it.
- **Two-tap also changes the physical button** for `autoFlush`/`manual` — call
  this out in the Machine-tab copy.

## Testing

- Unit (`LiveShotContext.test.tsx`): clock starts at `pouring`, not warm-up;
  `opPhase` transitions heating→steaming→purging→idle off substate; purge latch
  fires once; dwell timer cancels on early end. (no runner configured yet — see
  CLAUDE.md; add Vitest or assert via existing test files' harness.)
- Unit (`machineActivity.test.ts`): steam phase mapping for
  pouring/pouringDone/idle/preparingForShot.
- Manual on hardware, repeat the original matrix and confirm against the trace
  tags (`cmd`, `state`, `op`, `steam`):
  1. short steam → purges (was bug 1)
  2. complete timer → purges
  3. stop early (app + physical) → purges promptly per strategy, countdown
     freezes at stop (was bugs 2,3,5)
  4. each of strategies a/b/c
  - capture a debug-log trace for each and verify `steam` purge marker + step
    advance.

## Decisions (locked 2026-05-31)

- Default dwell for `autoFlush` = **3 s**.
- **Keep the skin auto-stop as-is** (re-anchored to `pouring`). Do not drop it
  in favour of the firmware `TargetSteamLength` — it stays the enforcer (and the
  sim/`duration=0` backup).
- Naming **approved**: `SteamPurgeStrategy = 'firmware' | 'autoFlush' | 'manual'`.

## Open questions

- Whether to surface the firmware two-tap as its *own* physical-button toggle
  (Decenza does) — deferred; the strategy selector subsumes it for now.
