# starter-skin

Minimal Vite + TypeScript skin for [Decent.app](https://github.com/tadelv/reaprime).
Connects to the gateway's machine and scale snapshot WebSockets and shows live
state. Useful as a starting point — fork, rename, and grow it into a real skin.

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
npm run build      # → dist/
npm run preview    # serve the built bundle locally
```

## Deploy to Decent.app

Zip the contents of `dist/` (so `index.html` is at the zip root) and upload
via the gateway's WebUI endpoints. See `doc/Skins.md` in the reaprime repo for
the upload flow.

## What it talks to

- `GET /api/v1/machine/info` — basic machine info (logged to console)
- `PUT /api/v1/scale/tare` — tare on button click
- `ws://.../ws/v1/machine/snapshot` — machine state stream
- `ws://.../ws/v1/scale/snapshot` — scale weight stream (status frames + data frames)

Full API reference: `doc/Api.md` and `doc/Skins.md` in the reaprime repo.

## Layout

```
src/
  main.ts       # bootstrap, WS reconnect loop, button wiring
  api.ts        # typed REST client
  snapshot.ts   # MachineSnapshot, ScaleMessage types + state enums
  ui.ts         # DOM rendering
  styles.css
```
