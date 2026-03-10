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
let isPlotting = false;

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

// Paper sizes in landscape orientation (long edge = X, short edge = Y)
// to match AxiDraw V3/A3 travel: ~430 mm (X) × ~297 mm (Y)
const paperSizes = {
  A6: { width: 148, height: 105 },
  A5: { width: 210, height: 148 },
  A4: { width: 297, height: 210 },
  A3: { width: 420, height: 297 },
};

let currentPaperName = "A3";
let currentPaper = paperSizes[currentPaperName];

// Safe margin in mm – dots within this distance from the paper edge are
// neither plotted nor detected (≈ 1.5 cm).
const MARGIN_MM = 15;

// Calibration dots at 10%/90% of paper corners, in mm
// Order: top-left, top-right, bottom-left, bottom-right
let calibrationDots = [];
let calibrationNormalizedTargets = [];

function recalcCalibration() {
  calibrationDots = [
    { targetX: currentPaper.width * 0.1, targetY: currentPaper.height * 0.1 }, // TL
    { targetX: currentPaper.width * 0.9, targetY: currentPaper.height * 0.1 }, // TR
    { targetX: currentPaper.width * 0.1, targetY: currentPaper.height * 0.9 }, // BL
    { targetX: currentPaper.width * 0.9, targetY: currentPaper.height * 0.9 }, // BR
  ];
  calibrationNormalizedTargets = calibrationDots.map((d) => ({
    nx: d.targetX / currentPaper.width,
    ny: d.targetY / currentPaper.height,
  }));
}
recalcCalibration();

let calibrationMatchedCount = 0;
let calibrationPlottingDone = false; // only compute transform after plotter finishes
let lastWaitingSafeCount = 0; // safe-dot baseline for game start

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
    paperSizes: Object.keys(paperSizes),
    currentPaperName,
  };
}

// ---------------------------------------------------------------------------
// Plot dot(s) – coordinates in mm; plotdot.py uses units=2 (mm)
// ---------------------------------------------------------------------------

const plotDots = async (dots) => {
  const json = JSON.stringify(dots);
  await $`.venv/bin/python plotdot.py ${json}`;
};

const plotDot = async (x, y) => {
  await plotDots([{ x, y }]);
};

// Dot placement + spatial sort — imported from src/lib/geometry.js

// ---------------------------------------------------------------------------
// Calibration run: plot 4 corner dots, then wait for webcam detection
// ---------------------------------------------------------------------------

const runCalibration = async () => {
  calibrationMatchedCount = 0;
  calibrationPlottingDone = false;
  setState(STATE.CALIBRATING);
  console.log("Starting calibration – plotting 4 corner dots…");
  try {
    await plotDots(
      calibrationDots.map((d) => ({ x: d.targetX, y: d.targetY })),
    );
    console.log("All calibration dots plotted. Waiting for webcam detection…");
    calibrationPlottingDone = true;
  } catch (e) {
    console.error("Calibration plotting failed (plotter error):", e.message);
    setState(STATE.WAITING_FOR_SHEET);
  }
};

// ---------------------------------------------------------------------------
// New dot (READY state): find farthest point, transform to mm, plot
// ---------------------------------------------------------------------------

const createNewDot = async ({ dots, maxWidth, maxHeight }) => {
  if (isPlotting) {
    console.log("⏳ Plotter busy – ignoring new dot request");
    return;
  }
  if (!pixelToMmMatrix) {
    console.warn("⚠ Not calibrated – skipping plot");
    return;
  }
  // Compute margin in pixel space (proportional to the crop canvas)
  const marginPx = MARGIN_MM * (maxWidth / currentPaper.width);
  const newDot = getFarthestPoint(dots, maxWidth, maxHeight, {
    margin: marginPx,
  });
  if (!newDot) {
    console.warn(
      `⚠ getFarthestPoint returned null (${dots.length} input dots, ` +
        `canvas ${maxWidth}×${maxHeight}, margin ${marginPx.toFixed(1)}px) – skipping`,
    );
    return;
  }

  const mm = applyAffineTransform(pixelToMmMatrix, newDot.x, newDot.y);
  console.log(
    `Plotting new dot at (${mm.x.toFixed(1)}, ${mm.y.toFixed(1)}) mm`,
  );

  // Validate coordinates are within the safe area (paper bounds minus margin)
  if (
    mm.x < MARGIN_MM ||
    mm.y < MARGIN_MM ||
    mm.x > currentPaper.width - MARGIN_MM ||
    mm.y > currentPaper.height - MARGIN_MM
  ) {
    console.error(
      `Dot (${mm.x.toFixed(1)}, ${mm.y.toFixed(1)}) mm is outside safe area ` +
        `(margin ${MARGIN_MM} mm inside ${currentPaper.width}×${currentPaper.height} mm) – skipping.`,
    );
    return;
  }

  isPlotting = true;
  try {
    await plotDot(mm.x, mm.y);
  } catch (e) {
    console.error("Plotting failed (plotter error):", e.message);
    return;
  } finally {
    isPlotting = false;
  }

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
      // Initialise previousDots length to match the safe dots already on the
      // sheet so the first human dot (not a pre-existing dot) triggers
      // the plotter response.
      previousDots = Array.from({ length: lastWaitingSafeCount }, () => ({}));
      setState(STATE.READY);
      console.log(
        `Game started. Baseline: ${previousDots.length} safe dot(s) already on sheet.`,
      );
    }
  });

  // Client requests a new calibration run (no server restart needed)
  socket.on("recalibrate", async () => {
    console.log("Recalibration requested by client");
    await runCalibration();
  });

  // Client selects a different paper size
  socket.on("setPaperSize", (name) => {
    if (!paperSizes[name]) return;
    console.log(`Paper size changed to ${name}`);
    currentPaperName = name;
    currentPaper = paperSizes[name];
    recalcCalibration();
    pixelToMmMatrix = null;
    io.emit("serverState", buildStatePayload());
  });

  socket.on("detectedDots", async (detection) => {
    const dotCount = detection.dots.length;

    if (currentState === STATE.CALIBRATING) {
      if (!calibrationPlottingDone) {
        // Plotter is still drawing the corner dots – ignore interim detections
        // to avoid computing the transform with pre-existing dots.
        calibrationMatchedCount = detection.dots.length;
        io.emit("serverState", buildStatePayload());
        return;
      }

      // Filter margin dots in pixel space (no mm matrix yet; use proportional margin)
      const calMarginPxX =
        MARGIN_MM * (detection.maxWidth / currentPaper.width);
      const calMarginPxY =
        MARGIN_MM * (detection.maxHeight / currentPaper.height);
      const calDots = detection.dots.filter(
        (d) =>
          d.x >= calMarginPxX &&
          d.y >= calMarginPxY &&
          d.x <= detection.maxWidth - calMarginPxX &&
          d.y <= detection.maxHeight - calMarginPxY,
      );
      const calFiltered = detection.dots.length - calDots.length;
      if (calFiltered > 0) {
        console.log(
          `  Calibration: ${calFiltered} dot(s) outside pixel margin (${calMarginPxX.toFixed(1)}px / ${calMarginPxY.toFixed(1)}px) ignored`,
        );
      }

      if (calDots.length >= calibrationDots.length) {
        console.log("Enough dots detected – computing affine transform…");

        const sortedDetected = sortDotsBySpatialOrder(calDots);
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
        calibrationMatchedCount = calDots.length;
        io.emit("serverState", buildStatePayload());
        console.log(
          `${calDots.length}/${calibrationDots.length} calibration dots visible`,
        );
      }
      return;
    }

    if (currentState === STATE.READY) {
      // Filter out dots that fall within the safe margin (in mm)
      let marginFilteredCount = 0;
      const safeRange = {
        xMin: MARGIN_MM,
        yMin: MARGIN_MM,
        xMax: currentPaper.width - MARGIN_MM,
        yMax: currentPaper.height - MARGIN_MM,
      };
      const safeDots = pixelToMmMatrix
        ? detection.dots.filter((d) => {
            const mm = applyAffineTransform(pixelToMmMatrix, d.x, d.y);
            const inside =
              mm.x >= safeRange.xMin &&
              mm.y >= safeRange.yMin &&
              mm.x <= safeRange.xMax &&
              mm.y <= safeRange.yMax;
            if (!inside) {
              marginFilteredCount++;
              if (marginFilteredCount <= 3) {
                console.log(
                  `  ✗ dot px(${d.x}, ${d.y}) → mm(${mm.x.toFixed(1)}, ${mm.y.toFixed(1)}) ` +
                    `outside safe [${safeRange.xMin}–${safeRange.xMax}, ${safeRange.yMin}–${safeRange.yMax}]`,
                );
              }
            }
            return inside;
          })
        : detection.dots;

      if (marginFilteredCount > 3) {
        console.log(
          `  … and ${marginFilteredCount - 3} more dots outside margin`,
        );
      }

      console.log(
        `Dots: ${dotCount} detected, ${safeDots.length} safe` +
          (marginFilteredCount > 0
            ? ` (${marginFilteredCount} outside margin)`
            : "") +
          ` | previous: ${previousDots.length}` +
          ` | need: ${previousDots.length + 1} to respond`,
      );

      if (safeDots.length > previousDots.length) {
        console.log(
          `✅ New dot(s) detected (${safeDots.length} > ${previousDots.length}) – responding…`,
        );
        await createNewDot({
          dots: safeDots,
          maxWidth: detection.maxWidth,
          maxHeight: detection.maxHeight,
        });
      }
    } else if (currentState === STATE.WAITING_FOR_SHEET) {
      // Track the safe-dot count so we can use it as a baseline when the
      // game starts (avoids immediately responding to pre-existing dots).
      if (pixelToMmMatrix) {
        const safeRange = {
          xMin: MARGIN_MM,
          yMin: MARGIN_MM,
          xMax: currentPaper.width - MARGIN_MM,
          yMax: currentPaper.height - MARGIN_MM,
        };
        lastWaitingSafeCount = detection.dots.filter((d) => {
          const mm = applyAffineTransform(pixelToMmMatrix, d.x, d.y);
          return (
            mm.x >= safeRange.xMin &&
            mm.y >= safeRange.yMin &&
            mm.x <= safeRange.xMax &&
            mm.y <= safeRange.yMax
          );
        }).length;
      } else {
        lastWaitingSafeCount = 0;
      }
      console.log(
        `Dots: ${dotCount} detected – ignoring (state: ${currentState}, ${lastWaitingSafeCount} safe)`,
      );
    } else if (currentState !== STATE.CALIBRATING) {
      console.log(
        `Dots: ${dotCount} detected – ignoring (state: ${currentState})`,
      );
    }
  });
});
