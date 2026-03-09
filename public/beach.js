// Array to store points
let points = [];
// Interval in milliseconds between adding new points
const intervalTime = 1000;
// Last time a point was added
let lastPointTime = 0;
// Number of candidate points to evaluate
const numCandidates = 100;

function setup() {
  createCanvas(800, 800);
}

function draw() {
  background(255);

  // Check if it's time to add a new point
  let currentTime = millis();
  if (currentTime - lastPointTime > intervalTime) {
    // Add a new point that's as far away as possible
    let newPoint = getFarthestPoint();
    points.push(newPoint);
    lastPointTime = currentTime;
  }

  // Draw all points
  for (let point of points) {
    fill(point.color);
    noStroke();
    ellipse(point.x, point.y, 10, 10);
  }
}

// Calculate distance between two points
function distanceBetween(p1, p2) {
  return sqrt(sq(p1.x - p2.x) + sq(p1.y - p2.y));
}

// Find the point that's farthest from all existing points.
// Virtual dots along all 4 edges act as repellers so candidates near the
// border score no better than those near a real dot.
function getFarthestPoint() {
  const borderSamples = 20;
  const borderPoints = [];
  for (let i = 0; i < borderSamples; i++) {
    const t = i / (borderSamples - 1);
    borderPoints.push({ x: t * width, y: 0 }); // top
    borderPoints.push({ x: t * width, y: height }); // bottom
    borderPoints.push({ x: 0, y: t * height }); // left
    borderPoints.push({ x: width, y: t * height }); // right
  }

  const allPoints = [...points, ...borderPoints];

  let farthestPoint = null;
  let maxMinDistance = -1;

  for (let i = 0; i < numCandidates; i++) {
    let candidate = {
      x: random(width),
      y: random(height),
      color: "black",
    };

    let minDistance = Infinity;
    for (let existingPoint of allPoints) {
      let distance = distanceBetween(candidate, existingPoint);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }

    if (minDistance > maxMinDistance) {
      maxMinDistance = minDistance;
      farthestPoint = candidate;
    }
  }

  return farthestPoint;
}
