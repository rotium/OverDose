# starter-skin

Minimal SolidJS skin for [Decent.app](https://github.com/tadelv/reaprime).
Subscribes to the gateway's machine and scale snapshot WebSockets and renders
live state with fine-grained reactivity. Useful as a starting point — fork,
rename, and grow it into a real skin.

## Why SolidJS

Snapshots stream at up to ~10 Hz per device (more during a shot). Solid's
signal model means only the specific text nodes bound to changed fields
update — no component re-render, no virtual DOM diff, no GC churn. Same
mental fit for the chart layer when you add real-time graphs.

## Run

```bash
npm install

# Start a Decent.app gateway with simulated devices in another terminal:
#   cd ../reaprime && flutter run --dart-define=simulate=machine,scale

# Then in this folder:
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/api/*` and `/ws/*` to `localhost:8080` (the
gateway). Override the gateway host with:

```bash
GATEWAY_HOST=192.168.1.42:8080 npm run dev
```

## Build

```bash
npm run build      # type-check + bundle → dist/
npm run preview    # serve the built bundle locally
```

## Deploy to Decent.app

Zip the contents of `dist/` (so `index.html` is at the zip root) and upload
via the gateway's WebUI endpoints. See `doc/Skins.md` in the reaprime repo for
the upload flow.

## What it talks to

- `GET /api/v1/machine/info` — basic machine info (logged to console on mount)
- `PUT /api/v1/scale/tare` — tare on button click
- `ws://.../ws/v1/machine/snapshot` — machine state stream
- `ws://.../ws/v1/scale/snapshot` — scale weight stream (status frames + data frames)

Full API reference: `doc/Api.md` and `doc/Skins.md` in the reaprime repo.

## Layout

```
src/
  main.tsx                  # bootstrap: render <App />
  App.tsx                   # top-level shell, wires WS streams to components
  streams.ts                # createWsStream() — reconnecting WS as Solid signals
  api.ts                    # typed REST client
  snapshot.ts               # MachineSnapshot, ScaleMessage types + state enums
  styles.css
  components/
    Machine.tsx             # live machine state card
    Scale.tsx               # live weight + tare button
    ConnectionBadge.tsx     # WS status pill in header
    ShotChart.tsx           # real-time pressure/flow/weight chart (uPlot)
```

## Real-time chart

`ShotChart.tsx` uses [uPlot](https://github.com/leeoniya/uPlot) for the live
trace. The data path deliberately bypasses Solid's reactivity:

- A pre-allocated typed-array ring buffer (~60 s at 10 Hz, capacity 600)
  holds pressure / flow / weight.
- A single `createEffect` listens to the machine snapshot signal and calls
  `chart.setData(...)` directly on each tick.
- The chart instance is created once on mount and destroyed on cleanup; no
  re-render of the surrounding component ever touches it.

To extend (more traces, longer window, different scales), edit the `series`
and `axes` arrays in `ShotChart.tsx` and bump `BUFFER_SIZE` as needed.

## Adding more streams

Subscribe to any gateway WebSocket the same way:

```ts
const sensor = createWsStream<SensorSnapshot>('/ws/v1/sensors/<id>/snapshot', 'sensor');
// sensor.latest() and sensor.status() are signals
```
