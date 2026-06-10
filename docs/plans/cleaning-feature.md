# Cleaning: a first-class configurable maintenance feature

Status: **Settings + Maintenance + wizard (group-head / flush / steam-wand / soak)** (branch `feat/cleaning-settings`) · 2026-06-10 · next: UI cleanups, then descale fixed wizard

> Wizard engine (`components/maintenance/{cleaningWizard.ts,CleaningWizard.tsx}`) walks a cleaning's phases. Working: **group-head** (prep → profile run: save workflow once → load cleaning profile → `requestState('espresso')` → monitor → restore at end), **flush** & **steam-wand** runs (requestState + snapshot monitor, GHC-safe), **instruction/soak** phases, and **completion stamps `lastDoneAt`**. Workflow save/restore + profile resolution live in App (opaque token to the engine). **Descale** still renders as a placeholder instruction (its fixed flow is a later increment).

Implemented: `domain/cleaning.ts`, `repositories/{cleaning_repository,local_cleaning_repository,seed_cleanings,link_seed_cleaning_profiles}.ts`, `components/settings/sections/library/{CleaningsSection,CleaningEditor}.tsx`, wired into `domain/index`, `repositories/index`, `RepositoriesContext`, `librarySync`, `App.tsx`, `LibraryTab`. Tests: `cleaning.test.ts`, `local_cleaning_repository.test.ts`, `CleaningsSection.test.tsx`, `CleaningEditor.test.tsx` (27 new; full suite 730 pass; `npm run build` clean). Deviation from the spec below: live `byShots` next-due needs the gateway shot total (no `api.shots()` yet) — Settings shows time-based next-due + a static "every N shots"; the live shots countdown lands with Alerts.

Cleaning is modeled like Recipes — a configurable Library entity with its own
storage, editor, home surfacing, reminders, and a live runtime. This doc is the
source of truth for the design. The **Settings** component below is fully locked;
the other surfaces (Live wizard, Home quick-buttons, Alerts, History) are
sketched at the end and will be spec'd one at a time.

The four surfaces of the feature:
1. **Settings/Library** — define cleanings (this doc, locked).
2. **Maintenance overlay** — the *run* surface (built): a Settings-peer screen (header Maintenance button) with a Cleaning section listing **all** cleanings (incl. hidden) to Run. Home quick-buttons = a later fast-path for non-hidden ones.
3. **Alerts/reminders** — in-app "due" nudges (pending).
4. **Live view** — an app-owned step-wizard per operation (pending; descale spec'd in design notes).

---

## Domain primer (why the model looks like this)

A DE1 has four distinct cleaning operations — different chemicals, plumbing, and
targets. They are **not** interchangeable:

| Op | What it is | Chemical | Cleans |
|----|-----------|----------|--------|
| **Forward Flush x5** | a *profile* (runs as a shot) | Cafiza in **blind basket** (or none) | shower screen + lower group (coffee-contact) |
| **Clean** | firmware `clean` state | **citric acid in tank** (or water-only) | upper brass + flush valve + light internal descale |
| **Descale** | firmware `descale` state | **citric acid in tank** (or water-only) | everything Clean does **+ steam path** |
| **Flush** | firmware `hotWaterRinse` | none | quick group rinse |

**Safety rules (always surfaced, never user-editable):**
- Detergent (Cafiza) **only** ever in the blind basket — **never** in the water tank (damages internals).
- Citric acid **only** in the tank — **never** any other descaler (voids warranty).
- After a citric clean/descale, **rinse** until the water is no longer acidic.

---

## Entity (`src/domain/cleaning.ts`)

> **Redesigned 2026-06-10:** a cleaning is **Clean** (a user-composed, reorderable
> step list) or **Descale** (separate, fixed, app-owned). This replaced an earlier
> flat-kind model (profile/clean/descale/flush) — real cleaning is multi-pass
> (Cafiza forward-flush → rinse pass → flush → steam wand), which a fixed model
> couldn't express. Firmware `clean` (redundant descale-lite) and the `flush`
> kind were dropped; `flush` and `steamWandSoak` are now *steps*.

```ts
export type CleanStep =
  | { id: string; type: 'coffeeSide'; profileId?: string; withChemical?: boolean } // forward-flush run
  | { id: string; type: 'flush' }                                                  // plain hot-water rinse
  | { id: string; type: 'steamWand'; withChemical?: boolean }                      // steam Rinza/water into a jug
  | { id: string; type: 'steamWandSoak' }                                          // soak tip in hot water + needle (timer)
  | { id: string; type: 'waterTank' }                                              // wash the water tank (manual)
  | { id: string; type: 'thimble' };                                               // soak uptake thimble in 5% citric (timer)

export type CleaningOperation =
  | { kind: 'clean'; steps: CleanStep[] }      // user-composed, reorderable
  | { kind: 'descale'; withChemical?: boolean };// fixed, app-owned

export interface Cleaning {
  id: string;
  name: string;
  operation: CleaningOperation;
  cadence?: { byDays?: number; byShots?: number };  // "due" if EITHER threshold crosses
  notes?: string;
  hidden?: boolean;                                 // shown on Home by default; hide to drop off
  order?: number;
  lastDoneAt?: string;                              // ISO; denormalized for fast due-calc
  lastDoneShotCount?: number;                       // espresso-shot total snapshot at completion
}
// `icon` and per-step prep text are DERIVED, never stored.
```

**Chemical is per-step / per-mode, and three chemicals never cross paths:**

| where | chemical (`withChemical: true`) | location |
|-------|----------------------------------|----------|
| `coffeeSide` step | Cafiza | **blind basket** |
| `steamWand` step | Rinza | **milk jug** |
| `descale` | citric acid | **water tank** |

Safety rule (per-step, shown in the wizard): detergent only in the basket, Rinza only in the jug, citric only in the tank — never the tank with detergent, never a non-citric descaler.

---

## Storage (mirrors the Recipe pattern)

Local-first, swappable for a gateway impl later:
- `src/repositories/cleaning_repository.ts` — interface (`list/get/create/update/delete/replaceAll`).
- `src/repositories/local_cleaning_repository.ts` — `localStorage` key `starter-skin.cleanings.v1`, `seedIfFirstRun()`, `onChange` callback (fires on user mutations only).
- `src/repositories/seed_cleanings.ts` — seed data.
- Wired into `RepositoriesContext` + `librarySync` (revision `Accessor<number>`; lists via `createResource(repos.revision, () => repos.cleanings.list())`).

**Seeds** (carry good defaults so users tweak, not build from blank):
- *Daily Rinse* — `clean` · `[coffeeSide, flush, coffeeSide, flush, steamWandSoak]` · every 1 day.
- *Weekly Clean* — `clean` · `[coffeeSide(Cafiza), flush, coffeeSide, flush, steamWand(Rinza), waterTank, thimble]` · ~7 days / 50 shots.
- *Steam Wand* — `clean` · `[steamWand(Rinza), steamWandSoak]`.
- *Descale* — `descale` · citric · reminders off (water-dependent) · hidden from Home by default.
- coffeeSide steps resolve their profile from the `Cleaning/Forward Flush x5` title at first run.

Seed profiles are referenced **by title** (`Cleaning/Forward Flush x5`) and resolved to
the gateway profile id at first run — gateway profile ids are content hashes and
vary per machine.

---

## CleaningsSection (the list)

- Header **"Cleanings"** + **[ + New Cleaning ]** + one-line help.
- Row layout: **auto icon · name · next-due summary · `● due` · eye hide/show toggle** (Recipe-style; hidden rows dimmed).
  - Next-due is **forward-looking**: `Next in 3 days` / `in 22 shots` / `Due now` / `Overdue 2d` (whichever threshold is closer).
- Tap a row → opens the editor (side-sheet). `+ New` → inline name + operation select → editor.
- Insertion order. Empty state when none.

```
┌────────────────────────────────────────────────────────┐
│  Cleanings                          [ + New Cleaning ]   │
│  Maintain your machine. Shown on home unless hidden.     │
│ ┌──────────────────────────────────────────────────────┐│
│ │ 🚿  Daily Rinse           Next in 14 h            👁 ││
│ │     Forward Flush · no detergent                     ││
│ ├──────────────────────────────────────────────────────┤│
│ │ 🧼  Weekly Group Clean    Due now        ● due   👁 ││
│ │     Forward Flush · Cafiza                           ││
│ ├──────────────────────────────────────────────────────┤│
│ │ 💧  Descale (hidden)       reminder off          🚫 ││
│ │     Citric acid · internal + steam                   ││
│ └──────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

---

## CleaningEditor (side-sheet, auto-save)

Two editors by mode (mode is set at create, read-only after):

**Clean** — a user-composed **step builder** (mirrors `RoutineEditor`):
```
┌─ Edit Cleaning ─────────────────────────────[X]─┐
│ Clean                                            │
│ Name      [ Weekly Clean                     ]   │
│ ┌─ Steps ──────────────────────────────────────┐│
│ │ ↑ ↓   Group head        ◉ Cafiza         ✕  ││
│ │ ↑ ↓   Group head        ○ no chemical    ✕  ││
│ │ ↑ ↓   Flush                               ✕  ││
│ │ ↑ ↓   Steam wand         ◉ Rinza          ✕  ││
│ │ ↑ ↓   Steam-wand soak                     ✕  ││
│ │ [ + Add step ]   → Group head/Flush/Steam wand/Soak │
│ └───────────────────────────────────────────────┘│
│ Reminders [✓]  every [7] days · [50] shots       │
│ Last done 3 days ago      [ Reset ]              │
│ Notes     [ … ]                                  │
│ [ ] Hide from the home screen                    │
│ [ Delete cleaning ]                              │
└──────────────────────────────────────────────────┘
```
- Step row = `↑ ↓` reorder (first `↑` / last `↓` disabled) · type · inline chemical toggle (group-head/steam-wand only) · `✕`. Group head **expands** to show its profile (defaults to `Cleaning/Forward Flush x5`, tucked).
- **`+ Add step`** opens a type picker (Group head / Flush / Steam wand / Steam-wand soak), mirroring RoutineEditor's add-step.
- Reorder = **up/down arrows, not drag** — touch tablet (HTML5 DnD fails on touch), rows are tappable (drag/tap conflict), short lists, and consistent with RoutineEditor.
- **No editor prep card** — per-step prep + safety surface in the *wizard* at run time (and a one-line hint on an expanded step).

**Group head profile picker filter:** `title.startsWith('Cleaning/') || beverage_type === 'cleaning'`, prefix stripped in labels.

**Descale** — fixed editor: Name · `[✓] Citric acid in the tank` · Prep card (cooldown ⚠ / citric-only ⚠ / v1.0-v1.1) · Reminders · Notes · Hide · Delete. No steps.

Shared (both): Reminders (days/shots, due if either crosses), Notes, Last done + Reset reminder, Hide from home (Recipe-style, just above Delete), Delete.

---

## Locked rules

- **Chemical is per-step/per-mode and never crosses paths** (Cafiza→basket, Rinza→jug, citric→tank). Safety lines are app-authored, shown per-step in the wizard, not editable.
- **Clean = user-composed steps; Descale = fixed app-owned wizard.** The "no user-authored steps" rule was reversed for Clean only (safe surface ops); descale stays fixed (safety-critical).
- **"Reset reminder"** is a *neutral, per-cleaning* action: it restarts that cleaning's countdown and does **not** claim a run happened. Real completions are auto-recorded by the **wizard** (see History). No bulk "mark all done."
- **Icon is auto** (per kind + chemical), not user-editable in v1.
- **Recipe-style `hidden`** — cleanings show on Home by default; a low-emphasis **Hide** toggle (on its own, just above Delete) drops one off. **Delete** is the sole removal.

## Gateway constraints that shape settings

- **Shot counter:** firmware exposes none (de1app keeps a software-only `espresso_count`). The gateway's `GET /api/v1/shots` returns `total` (a `countShots()`), which is the `byShots` source: `shotsSince = currentTotal − lastDoneShotCount`. Clamp ≥ 0; treat as **approximate** (deleting shot history can shrink the total).
- **`byShots` is clean:** profile cleaning runs are **not** counted as shots — `de1_state_manager._persistShotIfNeeded()` skips `beverage_type` `cleaning`/`calibrate`. So "every 50 shots" means 50 actual coffees.
- **No gateway cleaning history:** the gateway/firmware store **nothing** about clean/descale runs or counts. Therefore the History component is **entirely OverDose-owned**.

---

## Remaining components (sketched; to be spec'd one at a time)

**History** — fully OverDose-owned, local-first append log; the entity's
`lastDoneAt`/`lastDoneShotCount` are the denormalized latest-event cache.
```ts
CleaningHistoryEntry {
  id; cleaningId; name; kind; withChemical;
  timestamp; shotCountAt; source: 'run' | 'reset';
}
```
Written on **wizard completion**; nice-to-have: opportunistically log when OverDose
*observes* a firmware clean/descale state run to completion even if not
wizard-initiated.

**Live view** — an app-owned **step-wizard** per kind (users don't author steps).
Step types: Instruction / Wait-for-condition / Machine-run / Rinse-loop.
Machine-run UI = **progress bar / countdown + phase label, no chart**.
Descale specifics (cool-down ≤ 60 °C → suspend + "Waiting for descale" badge;
citric 5%; v1.0/v1.1 ≤ 5% warning; two taste-gated rinse loops asking after each
pass; re-enable steam heater at the end) are captured in design notes.

**Home quick-buttons** — pinned cleanings on home; placement (dedicated
"Maintenance" row vs extending the Explore tray) not yet decided.

**Alerts** — in-app only (webview, no native push); **nudge-only, never block**.
`due = (now − lastDoneAt ≥ byDays) OR (currentTotalShots − lastDoneShotCount ≥ byShots)`.
