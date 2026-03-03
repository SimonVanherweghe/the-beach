#!/usr/bin/env zx

import express from "express";
import http from "http";
import fs from "fs";
import { $, argv } from "zx";
import { Server } from "socket.io";

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const port = process.env.PORT || 3005;

let previousDots = [];

const STATE = {
  CALIBRATING: "calibrating",
  WAITING_FOR_SHEET: "waitingForSheet",
  READY: "ready",
};

let currentState = STATE.READY;

const setState = (newState) => {
  console.log(`State changing from ${currentState} to ${newState}`);
  currentState = newState;
  io.emit("serverState", buildStatePayload());
};

const paperSizes = {
  A6: { width: 105, height: 148 },
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};

const currentPaper = paperSizes.A6;

// Calibration dots at 10%/90% of paper corners, in mm
// Order: top-left, top-right, bottom-left, bottom-right
const calibrationDots = [
  { targetX: currentPaper.width * 0.1, targetY: currentPaper.height * 0.1 }, // TL
  { targetX: currentPaper.width * 0.9, targetY: currentPaper.height * 0.1 }, // TR
  { targetX: currentPaper.width * 0.1, targetY: currentPaper.height * 0.9 }, // BL
  { targetX: currentPaper.width * 0.9, targetY: currentPaper.height * 0.9 }, // BR
];

// Normalized (0–1) targets sent to the client for the calibration overlay
const calibrationNormalizedTargets = calibrationDots.map((d) => ({
  nx: d.targetX / currentPaper.width,
  ny: d.targetY / currentPaper.height,
}));

let calibrationMatchedCount = 0;

const CALIBRATION_FILE = "./calibration.json";
let pixelToMmMatrix = null; // [[a,b,c],[d,e,f]]: x_mm = a*px + b*py + c

// ---------------------------------------------------------------------------
// Affine transform helpers
// ---------------------------------------------------------------------------

/**
 * Compute a 2×3 affine matrix from 4 pixel→mm point correspondences.
 * pixelPoints: [{x,y}, ...]  (crop-canvas pixel space, 0–TRANSFORM_WIDTH/HEIGHT)
 * mmPoints:    [{x,y}, ...]  (paper mm space)
 * Returns [[a,b,c],[d,e,f]] where:
 *   x_mm = a*px + b*py + c
 *   y_mm = d*px + e*py + f
 */
function computeAffineTransform(pixelPoints, mmPoints) {
  const A = pixelPoints.map((p) => [p.x, p.y, 1]);
  const bx = mmPoints.map((p) => p.x);
  const by = mmPoints.map((p) => p.y);
  return [solveLeastSquares3(A, bx), solveLeastSquares3(A, by)];
}

/** Least-squares solve of A (n×3) * x = b using normal equations A^T A x = A^T b */
function solveLeastSquares3(A, b) {
  const ATA = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const ATb = [0, 0, 0];
  for (let i = 0; i < A.length; i++) {
    for (let r = 0; r < 3; r++) {
      ATb[r] += A[i][r] * b[i];
      for (let c = 0; c < 3; c++) {
        ATA[r][c] += A[i][r] * A[i][c];
      }
    }
  }
  return solveLinear3x3(ATA, ATb);
}

/** Solve a 3×3 linear system via Gaussian elimination */
function solveLinear3x3(A, b) {
  const n = 3;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
    }
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    for (let k = i + 1; k < n; k++) {
      const f = aug[k][i] / aug[i][i];
      for (let j = i; j <= n; j++) aug[k][j] -= f * aug[i][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i];
  }
  return x;
}

function applyAffineTransform(matrix, px, py) {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  return { x: a * px + b * py + c, y: d * px + e * py + f };
}

// ---------------------------------------------------------------------------
// Calibration persistence
// ---------------------------------------------------------------------------

function loadCalibration() {
  try {
    if (fs.existsSync(CALIBRATION_FILE)) {
      const data = JSON.parse(fs.readFileSync(CALIBRATION_FILE, "utf-8"));
      if (data.matrix) {
        pixelToMmMatrix = data.matrix;
        console.log("Loaded calibration from", CALIBRATION_FILE);
        return true;
      }
    }
  } catch (e) {
    console.warn("Failed to load calibration:", e.message);
  }
  return false;
}

function saveCalibration() {
  try {
    fs.writeFileSync(
      CALIBRATION_FILE,
      JSON.stringify({ matrix: pixelToMmMatrix }, null, 2),
    );
    console.log("Calibration saved to", CALIBRATION_FILE);
  } catch (e) {
    console.warn("Failed to save calibration:", e.message);
  }
}

// ---------------------------------------------------------------------------
// State payload (sent to clients via serverState event)
// ---------------------------------------------------------------------------

function buildStatePayload() {
  return {
    state: currentState,
    calibrationTargets: calibrationNormalizedTargets,
    calibrationMatchedCount,
  };
}

// ---------------------------------------------------------------------------
// Plot dot – x, y in mm; plotdot.py uses units=1 (mm)
// ---------------------------------------------------------------------------

const plotDot = async (x, y) => {
  await $`python plotdot.py ${x} ${y}`;
};

// ---------------------------------------------------------------------------
// Dot placement algorithm (p5.js globals replaced with Math.*)
// ---------------------------------------------------------------------------

function distanceBetween(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

const getFarthestPoint = (points, width, height) => {
  const numCandidates = 100;
  if (points.length === 0) {
    return { x: Math.random() * width, y: Math.random() * height };
  }
  let farthestPoint = null;
  let maxMinDistance = -1;
  for (let i = 0; i < numCandidates; i++) {
    const candidate = { x: Math.random() * width, y: Math.random() * height };
    let minDistance = Infinity;
    for (const existingPoint of points) {
      const distance = distanceBetween(candidate, existingPoint);
      if (distance < minDistance) minDistance = distance;
    }
    if (minDistance > maxMinDistance) {
      maxMinDistance = minDistance;
      farthestPoint = candidate;
    }
  }
  return farthestPoint;
};

// ---------------------------------------------------------------------------
// Calibration dot matching via spatial sort (TL, TR, BL, BR)
// ---------------------------------------------------------------------------

function sortDotsBySpatialOrder(dots) {
  // Sort all by x+y sum: smallest = TL, largest = BR
  const sorted = dots.slice().sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = sorted[0];
  const br = sorted[sorted.length - 1];
  const rest = sorted.slice(1, sorted.length - 1);
  // Among the middle two, smaller y = TR, larger y = BL
  const tr = rest[0].y <= rest[1].y ? rest[0] : rest[1];
  const bl = rest[0].y <= rest[1].y ? rest[1] : rest[0];
  return [tl, tr, bl, br]; // matches calibrationDots order
}

// ---------------------------------------------------------------------------
// Calibration run: plot 4 corner dots, then wait for webcam detection
// ---------------------------------------------------------------------------

const runCalibration = async () => {
  calibrationMatchedCount = 0;
  setState(STATE.CALIBRATING);
  console.log("Starting calibration – plotting 4 corner dots…");
  for (const dot of calibrationDots) {
    await plotDot(dot.targetX, dot.targetY);
  }
  console.log("All calibration dots plotted. Waiting for webcam detection…");
};

// ---------------------------------------------------------------------------
// New dot (READY state): find farthest point, transform to mm, plot
// ---------------------------------------------------------------------------

const createNewDot = async ({ dots, maxWidth, maxHeight }) => {
  if (!pixelToMmMatrix) {
    console.warn("Not calibrated – skipping plot");
    return;
  }
  const newDot = getFarthestPoint(dots, maxWidth, maxHeight);
  if (!newDot) return;

  const mm = applyAffineTransform(pixelToMmMatrix, newDot.x, newDot.y);
  console.log(
    `Plotting new dot at (${mm.x.toFixed(1)}, ${mm.y.toFixed(1)}) mm`,
  );
  await plotDot(mm.x, mm.y);

  // Update previousDots so the next detectedDots event sees this dot
  previousDots = dots.concat([{ x: newDot.x, y: newDot.y }]);
};

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

if (loadCalibration()) {
  currentState = STATE.WAITING_FOR_SHEET;
  console.log("Calibration loaded. Swap to a fresh sheet and click Start.");
}

if (argv.build) {
  await $`npm run build`;
}

app.use(express.static("dist"));

httpServer.listen(port, async () => {
  console.log(`Server listening on port ${port} – http://localhost:${port}`);
  if (argv.calibrate) {
    await runCalibration();
  }
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

io.on("connection", async (socket) => {
  console.log("Socket connected", socket.id);

  // Send current state immediately to the newly connected client
  socket.emit("serverState", buildStatePayload());

  socket.on("disconnect", () => {
    console.log("Socket disconnected", socket.id);
  });

  // Client confirms sheet has been swapped → start the game
  socket.on("startGame", () => {
    if (currentState === STATE.WAITING_FOR_SHEET) {
      previousDots = [];
      setState(STATE.READY);
      console.log("Game started on fresh sheet.");
    }
  });

  // Client requests a new calibration run (no server restart needed)
  socket.on("recalibrate", async () => {
    console.log("Recalibration requested by client");
    await runCalibration();
  });

  socket.on("detectedDots", async (detection) => {
    console.log(`Detected dots: ${detection.dots.length}`);

    if (currentState === STATE.CALIBRATING) {
      if (detection.dots.length >= calibrationDots.length) {
        console.log("Enough dots detected – computing affine transform…");

        const sortedDetected = sortDotsBySpatialOrder(detection.dots);
        const pixelPoints = sortedDetected.map((d) => ({ x: d.x, y: d.y }));
        const mmPoints = calibrationDots.map((d) => ({
          x: d.targetX,
          y: d.targetY,
        }));

        pixelToMmMatrix = computeAffineTransform(pixelPoints, mmPoints);
        calibrationMatchedCount = 4;
        saveCalibration();
        setState(STATE.WAITING_FOR_SHEET);
        console.log("Calibration complete. Matrix:", pixelToMmMatrix);
      } else {
        // Update live progress counter
        calibrationMatchedCount = detection.dots.length;
        io.emit("serverState", buildStatePayload());
        console.log(
          `${detection.dots.length}/${calibrationDots.length} calibration dots visible`,
        );
      }
      return;
    }

    if (currentState === STATE.READY) {
      if (detection.dots.length > previousDots.length) {
        console.log("New dot(s) detected – responding…");
        await createNewDot(detection);
      }
    }
  });
});
