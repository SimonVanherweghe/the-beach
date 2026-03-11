# The Beach — Developer Handoff

Based on the [Conditional Design Workshop: The Beach](https://conditionaldesign.org/workshops/the-beach/).  
A human and a computer take turns placing dots on paper. The human draws with a pen; the computer responds via an **AxiDraw V3/A3** pen plotter watched by a webcam.

---

## Hardware requirements

| Item | Notes |
|---|---|
| AxiDraw V3/A3 | Connected via USB. Model 2 (`options.model = 2`). Fitted with the brushless servo upgrade kit (`options.penlift = 3`). |
| Webcam | Any USB or built-in camera. Selected at runtime from the browser UI. |
| Pen / marker | A thick marker works well. Pen width affects the `BORDER_BUFFER_MM` constant. |
| Paper | Default is **A3** landscape. A6, A5, A4 are also supported and selectable from the UI. |

---

## Software prerequisites

### Node.js

Install Node.js (v18+) and then all JS dependencies:

```bash
npm install
```

### Python virtual environment

The plotter scripts run from a `.venv` inside the project folder. Create it once:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install all Python dependencies in one go:

```bash
pip install -r requirements.txt
```

> The AxiDraw API is not on PyPI — `requirements.txt` points directly to the EvilMadScientist download URL so pip fetches it automatically.  
> **vpype** is used internally by `plotborder.py` to optimise pen paths before sending them to the plotter (linesort → linemerge → linesimplify). It is not required for `plotdot.py`.

---

## Running the system

### Development (frontend only, no plotter)

```bash
npm run dev
```

Starts the Vite dev server. Opens the webcam UI in the browser. The Socket.IO connection and plotter will not be available — useful for UI/detection work only.

### Production (full system)

```bash
node index.mjs
```

Serves the pre-built frontend from `dist/` and starts the Socket.IO server on port **3005** (override with `PORT` env var). Open `http://localhost:3005` in a browser on the same machine.

```bash
node index.mjs --build
```

Runs `npm run build` first, then starts the server.

```bash
node index.mjs --calibrate
```

Plots 4 calibration dots at the corners of the paper, then waits for the browser to detect them. Use this on first setup or after changing paper size.

### Running tests

```bash
npm test
```

Runs the Vitest unit test suite (no hardware required).

---

## First-time setup checklist

1. Install all Node and Python dependencies (see above).
2. Place a calibration sheet on the plotter (any A3/A4 paper).
3. Run `node index.mjs --calibrate`.
4. Open `http://localhost:3005` in a browser.
5. Aim the webcam at the paper and adjust the four perspective-corner handles until the yellow target circles align with the plotted dots.
6. When all four targets turn green the calibration matrix is computed and written to `calibration.json` automatically.
7. Swap to a **fresh, unmarked sheet**.
8. Click **Start game** in the browser.
9. The plotter draws the wavy border and "The beach" label — the game is now live.

On all subsequent startups (without `--calibrate`), `calibration.json` is loaded automatically and the server starts in `WAITING_FOR_SHEET` state.

---

## How the loop works

```
Human draws a dot on paper
        │
        ▼
Webcam captures the paper
        │
        ▼
Browser: perspective-corrects the image → crop canvas (400×300 px)
        │
        ▼
Dot detection (brightness threshold + flood fill + connected-component)
        │
        ▼
Temporal smoothing: EMA per dot + count hysteresis
        │
        ▼
Stability gate: dots must be stable for DOT_STABLE_MS before emitting
        │
        ▼
Socket.IO emit "detectedDots" → server
        │
        ▼
Server: getFarthestPoint() picks the candidate farthest from all existing dots
        │
        ▼
Affine transform: crop-canvas px → mm on paper
        │
        ▼
plotDot(x, y) → python plotdot.py '[{"x":…,"y":…}]'
        │
        ▼
AxiDraw draws a filled spiral dot (~1.5 mm radius) at (x, y)
        │
        ▼
Server adds the new dot to its internal state → loop repeats
```

When `MAX_DOTS` is reached the server plots the completion timestamp text and enters state `DONE`.

---

## State machine

```
CALIBRATING
    │  (all 4 calibration dots detected)
    ▼
WAITING_FOR_SHEET
    │  (user clicks "Start game")
    ▼
DRAWING_BORDER   ← plotter draws wavy border + "The beach" label
    │  (border done)
    ▼
READY            ← main game loop
    │  (MAX_DOTS reached)
    ▼
DONE             ← plotter writes completion timestamp
```

State is broadcast to all connected clients via the `serverState` Socket.IO event on every transition.

---

## Coordinate systems

| Space | Units | Description |
|---|---|---|
| Raw video | pixels | Full webcam frame, varies by camera |
| Left canvas (`canvas`) | pixels | Letterboxed video preview with drag handles |
| Crop canvas (`cropCanvas`) | pixels | Perspective-corrected, fixed at **400 × 300 px** |
| Paper / AxiDraw | **mm** | All server-side coordinates; origin = top-left of plotter travel |

The affine matrix in `calibration.json` converts crop-canvas pixels → mm.  
`applyAffineTransform(matrix, px, py)` performs the conversion.

---

## Key files

| File | Purpose |
|---|---|
| `index.mjs` | Node server: Express, Socket.IO, state machine, plotter orchestration |
| `src/main.js` | Browser: webcam, perspective transform, dot detection, socket client, UI |
| `src/style.css` | All UI styles |
| `src/lib/geometry.js` | Shared math: affine transform, `getFarthestPoint`, spatial sort, distance |
| `src/lib/dotDetection.js` | Pure dot detection: threshold → flood fill → connected components |
| `src/lib/homography.js` | Perspective (homography) transform for the 4-corner crop |
| `plotdot.py` | Draws a filled Archimedean spiral dot at given mm coordinates |
| `plotborder.py` | Draws the wavy border rectangle and "The beach" / completion label |
| `plotborder.py` | Run with `--complete "<timestamp>"` to add the ending text |
| `public/beach.js` | Standalone p5.js simulation of the dot algorithm (no hardware) |
| `public/beach.html` | Opens the simulation in the browser, no server needed |
| `calibration.json` | Auto-written after calibration; delete to force recalibration |
| `tests/unit/` | Vitest unit tests for geometry, dot detection, homography, spatial sort |

---

## Key constants

### `index.mjs`

| Constant | Default | Effect |
|---|---|---|
| `MARGIN_MM` | `15` | Exclusion zone around all paper edges (mm) |
| `TEXT_MARGIN_MM` | `30` | Wider exclusion on the right edge (portrait bottom) — reserved for the text strip |
| `MAX_DOTS` | `15` | Number of dots before the beach is declared "full" |
| `currentPaperName` | `"A3"` | Active paper size; also changeable via the browser UI |

### `src/main.js`

| Constant | Default | Effect |
|---|---|---|
| `TRANSFORM_WIDTH / HEIGHT` | `400 / 300` | Crop-canvas resolution (px) |
| `DOT_DETECTION_THRESHOLD_VAL` | `100` | Brightness cutoff (0 = black, 255 = white). Lower = only very dark dots. Runtime-tunable via the debug panel. |
| `MIN_DOT_SIZE / MAX_DOT_SIZE` | `5 / 200` | Area bounds (px²) for a valid dot blob |
| `COUNT_HYSTERESIS_VAL` | `4` | Frames a new dot count must persist before it is accepted |
| `DOT_STABLE_MS_VAL` | `500` | Ms the detected set must be stable before emitting to the server |
| `EMA_ALPHA_VAL` | `0.07` | Smoothing factor for dot position (lower = smoother, more lag) |
| `MOTION_THRESHOLD` | `5000` | Cumulative pixel-diff to consider the scene moving (gates detection) |
| `BORDER_BUFFER_MM` | `5` | Extra mm added to margin display in the UI to account for the wavy border line width |

Detection tuning values (`DOT_DETECTION_THRESHOLD_VAL`, `COUNT_HYSTERESIS_VAL`, `DOT_STABLE_MS_VAL`, `EMA_ALPHA_VAL`) are persisted to `localStorage` under the key `detection-tuning` and adjustable via the on-screen panel without a page reload.

### `plotborder.py`

| Constant | Default | Effect |
|---|---|---|
| `CHAR_HEIGHT_MM` | `11` | Cap-height of plotted text (mm) |
| `WAVE_AMPLITUDE` | `1.0` | Max displacement of the wavy border (mm) |
| `WAVE_PERIOD` | `60.0` | Wavelength of the sine border (mm); higher = smoother curves |
| `STEP_MM` | `2.0` | Resolution of the border polyline (mm per point) |

### `plotdot.py`

| Constant | Default | Effect |
|---|---|---|
| `DOT_RADIUS` | `1.5` | Radius of the filled spiral dot (mm) |
| `ARM_SPACING` | `0.8` | Distance between spiral arms; controls density of fill |

---

## Socket.IO events

| Event | Direction | Payload |
|---|---|---|
| `detectedDots` | client → server | `{ dots: [{x, y}], maxWidth: 400, maxHeight: 300 }` |
| `serverState` | server → client | `{ state, calibrationTargets, calibrationMatchedCount, paperSizes, currentPaperName, paperWidth, paperHeight, marginMm, textMarginMm, dotCount, maxDots }` |
| `startGame` | client → server | _(none)_ |
| `recalibrate` | client → server | _(none)_ |
| `setPaperSize` | client → server | `"A3"` / `"A4"` / `"A5"` / `"A6"` |

---

## Calibration details

Four dots are plotted at 10 % / 90 % of the paper's width and height in landscape orientation:

- Top-left, Top-right, Bottom-left, Bottom-right (in landscape).

The browser detects these and sorts them spatially (sum of x+y for TL/BR, difference for TR/BL) to establish a reliable ordering regardless of detection order.

`computeAffineTransform(pixelPoints, mmPoints)` solves a least-squares system to produce a 2×3 matrix `[[a,b,c],[d,e,f]]` where:

```
x_mm = a·px + b·py + c
y_mm = d·px + e·py + f
```

This matrix is saved to `calibration.json` and loaded on every subsequent startup automatically.

After calibration, the **Recalibrate** button in the browser triggers a new calibration cycle without restarting the server (fires the `recalibrate` socket event).

> Delete `calibration.json` and restart with `--calibrate` after changing paper size.

---

## The dot placement algorithm

`getFarthestPoint(points, width, height, opts)` (in `src/lib/geometry.js`, shared by server and the p5.js simulation):

1. Generate `numCandidates` (default 100) random points within the safe area.
2. For each candidate, compute its **minimum distance** to all existing dots and to virtual "border repeller" dots evenly spaced along all four edges.
3. Return the candidate with the **greatest** minimum distance.

This maximises spacing and naturally avoids clustering near the border.

---

## The dot drawing algorithm

`plotdot.py` draws a filled Archimedean spiral centred at the target coordinate:

- Radius grows linearly from 0 to `DOT_RADIUS` (1.5 mm) over `turns = DOT_RADIUS / ARM_SPACING` revolutions.
- The spiral path is sent as `lineto` commands to the AxiDraw in interactive mode.
- Multiple dots can be passed as a JSON array in a single invocation to minimise USB handshake overhead.

---

## AxiDraw configuration

Both Python scripts connect to the AxiDraw with these settings:

```python
ad.options.units  = 2   # work in mm
ad.options.model  = 2   # AxiDraw V3/A3
ad.options.penlift = 3  # brushless servo upgrade kit (narrow-band PWM)
```

The plotter's origin (0, 0) is its **home position** (pen-up, top-left of travel). Make sure you home the plotter before running any plot.

---

## Changing paper size

1. In the browser UI, select the new paper size from the dropdown — this fires `setPaperSize` to the server.
2. Delete `calibration.json`.
3. Restart with `node index.mjs --calibrate` and redo the calibration workflow.

Or change `currentPaperName` in `index.mjs` for a code-level default.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Dots detected in wrong positions | Perspective corners not aligned | Drag the four handles in the browser until they exactly match the paper corners |
| Plotter draws in the wrong place | Stale `calibration.json` | Delete `calibration.json` and recalibrate |
| Nothing detected | Lighting too dim or `DOT_DETECTION_THRESHOLD_VAL` too low | Increase threshold in the debug panel; add a consistent light source |
| Ghost dots from paper texture | Threshold too high | Lower threshold; ensure the paper is plain white |
| `⏳ Plotter busy` in logs | Previous movement still running | Normal — the server queues one dot at a time. Wait for it to finish. |
| Python import error for `pyaxidraw` | `.venv` not activated or API not installed | `source .venv/bin/activate` and reinstall the AxiDraw API zip |
| vpype not found | Missing Python dependency | `pip install vpype` inside `.venv` |
