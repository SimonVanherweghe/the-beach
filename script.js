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

// Find the point that's farthest from all existing points
function getFarthestPoint() {
	// If this is the first point, just return a random one
	if (points.length === 0) {
		return {
			x: random(width),
			y: random(height),
			color: "black",
		};
	}

	let farthestPoint = null;
	let maxMinDistance = -1;

	// Generate candidate points and find the one farthest from existing points
	for (let i = 0; i < numCandidates; i++) {
		let candidate = {
			x: random(width),
			y: random(height),
			color: "black",
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
}
