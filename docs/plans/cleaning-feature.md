# Cleaning: a first-class configurable maintenance feature

Status: **Settings + Maintenance-nav implemented** (branch `feat/cleaning-settings`) · 2026-06-10 · Run wiring (wizard) + other surfaces pending

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

```ts
export type CleaningOperation =
  | { kind: 'profile'; profileId?: string; withChemical?: boolean }  // Cafiza in basket
  | { kind: 'clean';   withChemical?: boolean }                      // citric in tank | water-only
  | { kind: 'descale'; withChemical?: boolean }                      // citric in tank | water-only
  | { kind: 'flush' };                                               // hot-water rinse, never chemical

export interface Cleaning {
  id: string;
  name: string;
  operation: CleaningOperation;
  cadence?: { byDays?: number; byShots?: number };  // "due" if EITHER threshold crosses
  notes?: string;                                   // personal addendum to the derived prep
  hidden?: boolean;                                 // shown on Home by default; hide to drop off
  order?: number;
  lastDoneAt?: string;                              // ISO; denormalized for fast due-calc
  lastDoneShotCount?: number;                       // espresso-shot total snapshot at completion
}
// `icon` and the prep text are DERIVED from operation, never stored.
```

`withChemical` is **kind-aware** (one boolean, label/meaning derived):

| kind | `withChemical: true` | `withChemical: false` |
|------|----------------------|------------------------|
| profile | Cafiza in blind basket | no detergent (deep rinse) |
| clean / descale | citric acid in tank | water-only internal flush |
| flush | — | — |

---

## Storage (mirrors the Recipe pattern)

Local-first, swappable for a gateway impl later:
- `src/repositories/cleaning_repository.ts` — interface (`list/get/create/update/delete/replaceAll`).
- `src/repositories/local_cleaning_repository.ts` — `localStorage` key `starter-skin.cleanings.v1`, `seedIfFirstRun()`, `onChange` callback (fires on user mutations only).
- `src/repositories/seed_cleanings.ts` — seed data.
- Wired into `RepositoriesContext` + `librarySync` (revision `Accessor<number>`; lists via `createResource(repos.revision, () => repos.cleanings.list())`).

**Seeds:**
- *Daily Rinse* — profile · `Cleaning/Forward Flush x5` · no chemical · every 1 day.
- *Weekly Group Clean* — profile · `Cleaning/Forward Flush x5` · Cafiza · ~7 days / 50 shots.
- *Descale* — descale · citric · reminders off (water-dependent) · hidden from Home by default.

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

## CleaningEditor (side-sheet, auto-save, fields conditional on kind)

| # | Field | Control | Shown when |
|---|-------|---------|------------|
| 1 | **Name** | text | always |
| 2 | **Operation** | read-only display (set at create; immutable — kinds are too different, make a new cleaning instead) | always |
| 3 | **Profile** | picker + ✕ (reuses ProfilePicker) | kind = profile |
| 4 | **Use chemical** | checkbox, kind-aware label | profile / clean / descale (not flush) |
| 5 | **Reminders** | toggle + `days` + `shots` (DebouncedNumberField) | always — due if either crosses |
| 6 | **Prep (auto)** | read-only box | always — derived from kind + chemical; safety ⚠ + est. duration |
| 7 | **Notes** | text | always — addendum on top of prep |
| 8 | **Last done · [ Reset reminder ]** | text + button | always |
| 9 | **Hide from home** | toggle → `hidden`, on its own just above Delete (Recipe-style) | always |
| 10 | **Delete** | button (confirm) | always |

**Profile picker filter (kind = profile):** show profiles where
`title.startsWith('Cleaning/') || beverage_type === 'cleaning'`, and **strip the
`Cleaning/` prefix** in labels (e.g. "Forward Flush x5", "Weber Spring Clean").

```
┌─ Edit Cleaning ────────────────────────────────[X]─┐   Descale variant:
│ Name        [ Weekly Group Clean              ]     │    – no Profile row
│ Operation   [ Cleaning profile             ▾ ]      │    – chemical label →
│ Profile     [ Forward Flush x5             ] [✕]    │      "Use citric acid (in tank)"
│ [✓] Use chemical  (Cafiza in blind basket)          │    – prep swaps to citric +
│                                                     │      ⚠ citric-only / v1.0-v1.1
│ Reminders   [✓] Remind me                           │
│      every [ 7 ] days   and/or   [ 50 ] shots       │
│ ┌ Prep (auto) ──────────────────────────────────┐  │
│ │ • Blind basket + ~3 g Cafiza                   │  │
│ │ • ⚠ Never put detergent in the water tank      │  │
│ │ • 5 pressure cycles (~90 s) → flush till clear │  │
│ └────────────────────────────────────────────────┘ │
│ Notes       [ green-lid Cafiza tub, ½ tsp     ]     │
│ Last done   3 days ago            [ Reset reminder ]│
│ [ ] Hide from the home screen                       │
│                                        [ Delete ]   │
└──────────────────────────────────────────────────────┘
```

---

## Locked rules

- **`withChemical` is kind-aware** and never crosses paths (detergent→basket, citric→tank). The safety lines are always shown in Prep and cannot be edited away.
- **Prep is a derived, read-only preview** of the wizard's instruction/safety copy — it rewrites as Operation/chemical change. Only **Notes** is editable.
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
