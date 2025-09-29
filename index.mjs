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
  { targetX: currentPaper.width * 0.1, targetY: currentPaper.height * 0.1 },
  { targetX: currentPaper.width * 0.9, targetY: currentPaper.height * 0.1 },
  { targetX: currentPaper.width * 0.1, targetY: currentPaper.height * 0.9 },
  { targetX: currentPaper.width * 0.9, targetY: currentPaper.height * 0.9 },
];
let calibrationStep = 0;

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
    // plot all the calibration dots, one by one
    console.log("Starting calibration...");

    for (let i = 0; i < calibrationDots.length; i++) {
      await plotDot(calibrationDots[i].targetX, calibrationDots[i].targetY);
    }
  }

  socket.on("disconnect", (socket) => {
    console.log("Socket disconnected", socket.id);
  });

  socket.on("detectedDots", async (detection) => {
    console.log("Detected dots:", detection.dots.length);
    if (currentState === STATE.CALIBRATING) {
      // do we have the sama amount of detected dots as calibration dots?
      if (detection.dots.length >= calibrationDots.length) {
        console.log("Calibration dots set");

        // find out which calibration dot is which
        const matchedDots = [];
        calibrationDots.forEach((calibrationDot) => {
          let closestDot = null;
          let closestDistance = Infinity;
          detection.dots.forEach((detectedDot) => {
            const distance = Math.hypot(
              calibrationDot.targetX - detectedDot.actualX,
              calibrationDot.targetY - detectedDot.actualY
            );
            if (distance < closestDistance) {
              closestDistance = distance;
              closestDot = detectedDot;
            }
          });

          if (closestDot) {
            matchedDots.push({
              ...calibrationDot,
              actualX: closestDot.actualX,
              actualY: closestDot.actualY,
            });
          }

          // calculate calibration factors
          const xFactors = matchedDots.map((dot) => dot.targetX / dot.actualX);
          const yFactors = matchedDots.map((dot) => dot.targetY / dot.actualY);

          xCalibrationFactor =
            xFactors.reduce((sum, val) => sum + val, 0) / xFactors.length;
          yCalibrationFactor =
            yFactors.reduce((sum, val) => sum + val, 0) / yFactors.length;

          console.log("xCalibrationFactor", xCalibrationFactor);
          console.log("yCalibrationFactor", yCalibrationFactor);
        });

        setState(STATE.READY);
      } else {
        console.log("Not enough calibration dots detected yet");
      }
    }
    if (currentState === STATE.READY) {
      if (detection.dots.length > previousDots.length) {
        console.log("New dots detected", detection.dots);
        createNewDot(detection);
      }
    }
  });
});
