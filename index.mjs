#!/usr/bin/env zx

import express from "express";
import http from "http";
import fs from "fs";
import { $, argv } from "zx";
import { Server } from "socket.io";
import {
  computeAffineTransform,
  applyAffineTransform,
  distanceBetween,
  getFarthestPoint,
  sortDotsBySpatialOrder,
} from "./src/lib/geometry.js";

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

// Affine transform, distance, farthest-point, spatial sort — imported from src/lib/geometry.js

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

// Dot placement + spatial sort — imported from src/lib/geometry.js

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
