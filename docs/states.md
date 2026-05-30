# Machine states & substates

How the DE1's state model flows through to the skin, and where it loses
fidelity. Three layers:

1. **Firmware** — what the DE1 reports (`reaprime/.../de1/de1.models.dart`:
   `De1StateEnum`, `De1SubState`, each with a hex value).
2. **Gateway domain** — reaprime's `MachineState` / `MachineSubstate`
   (`reaprime/.../device/machine.dart`), produced by the mapping in
   `de1.utils.dart`. Serialized to the skin by enum **`.name`**.
3. **Skin** — the TS unions in `overdose/src/snapshot.ts`. These must
   match the gateway-domain names exactly, or the value arrives as an
   unmodelled string.

> The gateway flattens many distinct firmware substates into a few domain
> ones (lossy). Anything the gateway flattens, the skin cannot recover.

## States

| FW hex | Firmware (`De1StateEnum`) | Description | Gateway (`MachineState`) | In skin? |
|---|---|---|---|---|
| 0x0 | sleep | Everything is off | `sleeping` | ✅ |
| 0x1 | goingToSleep | Transitioning to sleep | `sleeping` | ✅ (folded) |
| 0x2 | idle | Heaters controlled; tank heated if needed | `idle` | ✅ |
| 0x3 | busy | Firmware doing something uninterruptible | `busy` | ❌ |
| 0x4 | espresso | Making espresso | `espresso` | ✅ |
| 0x5 | steam | Making steam | `steam` | ✅ |
| 0x6 | hotWater | Making hot water | `hotWater` | ✅ |
| 0x7 | shortCal | Short calibration | `calibration` | ❌ |
| 0x8 | selfTest | Firmware self-check | `selfTest` | ❌ |
| 0x9 | longCal | Long calibration (may need user) | `calibration` | ❌ |
| 0xA | descale | Descale whole machine | `descaling` | ✅ |
| 0xB | fatalError | Something has gone horribly wrong | `error` | ✅ |
| 0xC | init | Machine has not been run yet | `booting` | ✅ |
| 0xD | noRequest | Placeholder for "requested state" (not reported) | `idle` | ✅ |
| 0xE | skipToNext | Skip to next frame / go idle | `skipStep` | ❌ |
| 0xF | hotWaterRinse | Hot water at available temp | `flush` | ✅ |
| 0x10 | steamRinse | A blast of steam | `steamRinse` | ✅ |
| 0x11 | refill | Needs/attempting a refill | `needsWater` | ✅ |
| 0x12 | clean | Clean group head | `cleaning` | ✅ |
| 0x13 | inBootLoader | Bootloader active, fw not run | `booting` | ✅ (folded) |
| 0x14 | airPurge | Air purge | `airPurge` | ✅ |
| 0x15 | schedIdle | Scheduled wake-up idle | `schedIdle` | ❌ |
| 0x22 | fwUpgrade | Firmware upgrade | `fwUpgrade` | ❌ |
| -1 | unknown | Default/unknown | `error` | — |

The gateway domain also defines `heating` and `preheating`, but the firmware
mapping never produces them (warm-up is reported as `idle` + `preparingForShot`).
They're vestigial; the skin carries them too, equally unused.

## Substates

| FW hex | Firmware (`De1SubState`) | Description | Gateway (`MachineSubstate`) | In skin? |
|---|---|---|---|---|
| 0x00 | noState | No state is relevant | `idle` | ✅ |
| 0x01 | heatWaterTank | Cold water not hot enough; heating tank | `preparingForShot` | ✅ |
| 0x02 | heatWaterHeater | Warm up hot-water heater for shot | `preparingForShot` | ✅ |
| 0x03 | stabilizeMixTemp | Stabilize mix temp; whole path to temp | `preparingForShot` | ✅ |
| 0x04 | preInfuse | Espresso only (HW/Steam skip) | `preinfusion` | ✅ |
| 0x05 | pour | Not used in steam | `pouring` | ✅ |
| 0x06 | end | Espresso only, atm | `pouringDone` | ✅ |
| 0x07 | steaming | Steam only | `pouring` | ✅ |
| 0x08 | descaleInt | Starting descale | `cleaningStart` | ✅ |
| 0x09 | descaleFillGroup | Descaling solution into group | `cleaningGroup` | ⚠️ typo |
| 0x0A | descaleReturn | Descaling internals | `cleaningGroup` | ⚠️ typo |
| 0x0B | descaleGroup | Descaling group | `cleaningGroup` | ⚠️ typo |
| 0x0C | descaleSteam | Descaling steam | `cleaningSteam` | ✅ |
| 0x0D | cleanInit | Starting clean | `cleaningStart` | ✅ |
| 0x0E | cleanFillGroup | Fill the group | `cleaningGroup` | ⚠️ typo |
| 0x0F | cleanSoak | Wait 60s to soak group head | `cleanSoaking` | ✅ |
| 0x10 | cleanGroup | Flush through group | `cleaningGroup` | ⚠️ typo |
| 0x11 | refill | Have we given up on a refill? | `idle` | ✅ (→idle) |
| 0x12 | **pausedSteam** | Are we paused in steam? | `idle` | ✅ (→idle) |
| 0x13 | userNotPresent | User is not present | `idle` | ✅ (→idle) |
| 0x14 | **puffing** | Puffing (wand purge) | `idle` | ✅ (→idle) |
| 200–216 | errorNaN … errorBootFill | 17 hardware/firmware faults | same names | ❌ all missing |
| 217 | errorNoAC | Front button off | `errorNoAC` | ✅ |

`⚠️ typo`: the skin's union has `cleaingGroup` (missing the second `n`); the
gateway sends `cleaningGroup`. Every clean/descale "group" phase is therefore
unmodelled in the skin.

## State ↔ substate relations (canonical sequences)

| State | Substates within it (FW → gateway) | Sequence |
|---|---|---|
| `idle` | noState→`idle`; heat*/stabilize→`preparingForShot`; refill→`idle`; userNotPresent→`idle`; errorNoAC→`errorNoAC` | warm-up climbs, settles to `idle` |
| `espresso` | stabilizeMixTemp→`preparingForShot` → preInfuse→`preinfusion` → pour→`pouring` → end→`pouringDone` | the shot lifecycle |
| `steam` | heat*/stabilize→`preparingForShot` → steaming→`pouring` → pausedSteam→`idle` / puffing→`idle` | warm-up → steaming → paused/purge (parent stays `steam`) |
| `hotWater` | heat*→`preparingForShot` → pour→`pouring` | |
| `flush` (hotWaterRinse) | pour→`pouring` | |
| `airPurge` | puffing→`idle` | trailing wand purge after steam |
| `cleaning` (clean) | cleanInit→`cleaningStart` → cleanFillGroup→`cleaningGroup` → cleanSoak→`cleanSoaking` → cleanGroup→`cleaningGroup` | |
| `descaling` | descaleInt→`cleaningStart` → fill/return/group→`cleaningGroup` → descaleSteam→`cleaningSteam` | |
| `needsWater` (refill) | refill→`idle` | |
| `error` (fatalError) | error* → matching `error*` substate | |

## Where the skin consumes state today

- `snapshot.ts` `isWarmingUp` — `booting`, or `idle`+`preparingForShot`.
- `snapshot.ts` `isHeaterOff` — `idle`+`errorNoAC`.
- `LiveShotContext` espresso lifecycle — `preparingForShot` (start, guarded on
  `espresso`), `pouringDone` (freeze), leaving `espresso` (reset); plus the
  `operationSession` that folds `airPurge` into the steam session.
- `RecipeBrewScreen` step completion — parent-state only (`cur !== target`).

## Known gaps / issues

1. **Steam end is invisible.** `steaming`→`pouring`, but `pausedSteam` and
   `puffing` both collapse to `idle`. Once steam stops, the skin sees
   `state=steam, substate=idle` — indistinguishable from steam warm-up idle
   without history. (Suspected cause of the parked steam-step-stuck bug.)
2. **`preparingForShot` is overloaded** — three warm-up substates collapse
   into it, and it fires outside espresso (wake-from-sleep), so substate logic
   must be guarded on the parent state.
3. **Skin missing states**: `busy`, `schedIdle`, `skipStep`, `calibration`,
   `selfTest`, `fwUpgrade`.
4. **Skin drops 17 error substates** — only `errorNoAC` modelled; any other
   fault is an unmodelled string.
5. **Typo**: `cleaingGroup` vs gateway `cleaningGroup`.
6. **Vestigial** `heating` / `preheating` states never produced.
