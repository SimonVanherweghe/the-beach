#!/usr/bin/env zx

import express from "express";
import http from "http";
import { $, argv } from "zx";
import { Server } from "socket.io";

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const port = process.env.PORT || 3005;

let previousDots = [];

const STATE = {
  CALIBRATING: "calibrating",
  READY: "ready",
};

let currentState = STATE.READY;
const setState = (newState) => {
  console.log(`State changing from ${currentState} to ${newState}`);
  currentState = newState;
};

const paperSizes = {
  A6: { width: 105, height: 148 },
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};

const currentPaper = paperSizes.A6;

const calibrationDots = [
  { targetX: 10, targetY: 10 },
  { targetX: currentPaper.width - 10, targetY: currentPaper.height - 10 },
  { targetX: 10, targetY: currentPaper.height - 10 },
  { targetX: currentPaper.width - 10, targetY: 10 },
  { targetX: currentPaper.width / 2, targetY: currentPaper.height / 2 },
];
let calibrationStep = 0;
let previousCalibrationDots = [];

let xCalibrationFactor = 1;
let yCalibrationFactor = 1;

const plotDot = async (x, y) => {
  await $`python plotdot.py ${x * xCalibrationFactor} ${
    y * yCalibrationFactor
  }`;
};

if (argv.calibrate) {
  setState(STATE.CALIBRATING);
}

if (argv.build) {
  await $`npm run build`;
}

app.use(express.static("dist"));

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port} - http://localhost:${port}`);
});

const createNewDot = async ({ dots, maxWidth, maxHeight }) => {
  const newDot = getFarthestPoint(dots, maxWidth, maxHeight);
};

// Calculate distance between two points
function distanceBetween(p1, p2) {
  return sqrt(sq(p1.x - p2.x) + sq(p1.y - p2.y));
}

// Find the point that's farthest from all existing points
const getFarthestPoint = (points, width, height) => {
  const numCandidates = 100;
  // If this is the first point, just return a random one
  if (points.length === 0) {
    return {
      x: random(width),
      y: random(height),
    };
  }

  let farthestPoint = null;
  let maxMinDistance = -1;

  // Generate candidate points and find the one farthest from existing points
  for (let i = 0; i < numCandidates; i++) {
    let candidate = {
      x: random(width),
      y: random(height),
    };

    // Find minimum distance to any existing point
    let minDistance = Infinity;
    for (let existingPoint of points) {
      let distance = distanceBetween(candidate, existingPoint);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }

    // If this candidate is farther than our previous best, update
    if (minDistance > maxMinDistance) {
      maxMinDistance = minDistance;
      farthestPoint = candidate;
    }
  }

  return farthestPoint;
};

// Function to check if a dot is close to an existing one
function isDotClose(dot, existingDots, tolerance = 5) {
  return existingDots.some(
    (existingDot) =>
      Math.abs(dot.actualX - existingDot.actualX) <= tolerance &&
      Math.abs(dot.actualY - existingDot.actualY) <= tolerance
  );
}

// Function to get a new dot not close to existing ones
function getNewDot(calibrationDots, previousCalibrationDots, tolerance = 5) {
  return calibrationDots.find(
    (dot) => !isDotClose(dot, previousCalibrationDots, tolerance)
  );
}

io.on("connection", async (socket) => {
  console.log("Socket connected", socket.id);

  if (currentState === STATE.CALIBRATING) {
    await plotDot(
      calibrationDots[calibrationStep].targetX,
      calibrationDots[calibrationStep].targetY
    );
  }

  socket.on("disconnect", (socket) => {
    console.log("Socket disconnected", socket.id);
  });

  socket.on("detectedDots", async (detection) => {
    console.log("Detected dots:", detection.dots.length);
    if (currentState === STATE.CALIBRATING) {
      const calibrationStatus = calibrationDots[calibrationStep];

      const currentDot = getNewDot(calibrationDots, previousCalibrationDots);
      currentDot.actualX = detection.dots[0].x;
      currentDot.actualY = detection.dots[0].y;

      console.log("Calibration status", currentDot);

      xCalibrationFactor =
        calibrationStatus.targetX / calibrationStatus.actualX;
      yCalibrationFactor =
        calibrationStatus.targetY / calibrationStatus.actualY;

      previousCalibrationDots.push(calibrationStatus);
      console.log("Calibration factors", {
        xCalibrationFactor,
        yCalibrationFactor,
      });

      if (calibrationStep < calibrationDots.length - 1) {
        calibrationStep++;
        await plotDot(
          calibrationDots[calibrationStep].targetX,
          calibrationDots[calibrationStep].targetY
        );
      }
    } else {
      if (detection.dots.length > previousDots.length) {
        console.log("New dots detected", detection.dots);
        createNewDot(detection);
      }
    }
  });
});
