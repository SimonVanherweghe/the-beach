# The Beach – Copilot Instructions

## Project Overview

A human/computer turn-by-turn art installation based on the [Conditional Design Workshop](https://conditionaldesign.org/workshops/the-beach/).  
A user draws a dot on paper; an **AxiDraw V3 plotter** responds with its own dot. A webcam watches the paper, detects dots, and closes the feedback loop.

## Architecture

```
Browser (index.html + src/main.js)
  └─ Webcam → Canvas → Perspective crop → Dot detection
  └─ Socket.IO client ──emit "detectedDots"──▶ Server (index.mjs)
                                                  └─ sortDotsBySpatialOrder()
                                                  └─ computeAffineTransform()   ← calibration
                                                  └─ getFarthestPoint()          ← game logic
                                                  └─ plotDot(x, y) → $ python plotdot.py x y
                                                                          └─ AxiDraw hardware
```

Two separate frontend entry points:

- **`index.html` / `src/main.js`** – Vite-bundled webcam UI (dot detection, perspective transform, Socket.IO client)
- **`public/beach.html` / `public/beach.js`** – Self-contained p5.js simulation of the dot algorithm (no server, no webcam)

## Key Files

| File               | Role                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| `index.mjs`        | zx-based server: Express + Socket.IO + AxiDraw orchestration                |
| `src/main.js`      | Webcam capture, perspective transform, dot detection, socket emit, state UI |
| `plotdot.py`       | AxiDraw driver: moves to (x, y) in **mm** and draws a 2×2 mm square         |
| `public/beach.js`  | p5.js simulation of `getFarthestPoint()` algorithm                          |
| `calibration.json` | Persisted affine pixel→mm matrix (auto-written after calibration)           |

## Developer Workflows

### Running the system

```bash
# Dev (frontend only, no plotter)
npm run dev

# Production server (serves dist/, loads calibration.json if present)
node index.mjs
node index.mjs --build       # builds Vite output first, then serves
node index.mjs --calibrate   # plots 4 corner dots and enters CALIBRATING state
```

### AxiDraw Python API

```bash
python -m pip install https://cdn.evilmadscientist.com/dl/ad/public/AxiDraw_API.zip
```

### Calibration workflow

1. `node index.mjs --calibrate` → plotter draws 4 corner dots on a calibration sheet
2. Browser overlay shows 4 yellow target circles; they turn green as dots are detected
3. When all 4 are found → `calibration.json` written → browser shows "Calibrated ✓ — swap to fresh sheet"
4. Swap paper, click **Start game** → server enters `READY`
5. On subsequent startups without `--calibrate`, `calibration.json` is loaded automatically
6. **Recalibrate** button in the browser triggers a new calibration without restarting the server

## Coordinate Systems & Units

- **Webcam/canvas**: pixel coordinates (left canvas, raw video space)
- **Crop canvas** (`TRANSFORM_WIDTH=400 × TRANSFORM_HEIGHT=300`): perspective-corrected pixel space — this is what dot `x`/`y` coordinates reference
- **Paper / AxiDraw**: mm. All server-side coords are mm; `plotdot.py` uses `ad.options.units = 1` (mm)
- **Affine transform** (`pixelToMmMatrix`): converts crop-canvas pixels → mm via `applyAffineTransform(matrix, px, py)`

## State Machine (`index.mjs`)

Three states: `CALIBRATING` → `WAITING_FOR_SHEET` → `READY`

- `setState()` automatically broadcasts `serverState` to all clients via Socket.IO
- New socket connections immediately receive the current state
- `WAITING_FOR_SHEET`: calibration done, waiting for user to swap to fresh sheet and click Start
- `READY`: any new dot in `"detectedDots"` triggers `createNewDot()` → `getFarthestPoint()` → `applyAffineTransform()` → `plotDot()`

## Calibration – Key Details

- 4 calibration dots at 10%/90% corners of the paper in mm (e.g. A6: TL=(10.5,14.8), TR=(94.5,14.8), BL=(10.5,133.2), BR=(94.5,133.2))
- Detection matching uses **spatial sort** (top-left/top-right/bottom-left/bottom-right by x+y sum) — avoids unit-space comparison bugs
- `computeAffineTransform(pixelPoints, mmPoints)` solves a least-squares 4-correspondence system, returns a 2×3 matrix

## Dot Placement Algorithm

`getFarthestPoint(points, width, height)` — samples 100 random candidates and picks the one with the greatest minimum distance to all existing points. Used in both `index.mjs` and `public/beach.js`.

## Socket Events

| Event          | Direction     | Payload                                                             |
| -------------- | ------------- | ------------------------------------------------------------------- |
| `detectedDots` | client→server | `{ dots: [{x,y}], maxWidth: 400, maxHeight: 300 }`                  |
| `serverState`  | server→client | `{ state, calibrationTargets: [{nx,ny}], calibrationMatchedCount }` |
| `startGame`    | client→server | _(none)_                                                            |
| `recalibrate`  | client→server | _(none)_                                                            |

## Dot Detection (`src/main.js`)

Key constants to tune:

- `DOT_DETECTION_THRESHOLD = 100` – brightness cutoff (0–255)
- `MIN_DOT_SIZE = 5` / `MAX_DOT_SIZE = 200` – area bounds in pixels
- `DOT_STABLE_MS = 1000` – dots must be stable for 1 s before emitting
- `MOTION_THRESHOLD = 5000` – pixel diff sum to consider the scene changed

## Paper Size

Default is **A6** (105 × 148 mm). Change `currentPaper` in `index.mjs` to switch. `calibration.json` must be deleted and recalibration run after changing paper size.
