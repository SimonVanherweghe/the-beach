/**
 * Affine transform and spatial geometry helpers.
 * Used by both server (index.mjs) and tests.
 */

// ---------------------------------------------------------------------------
// Linear algebra
// ---------------------------------------------------------------------------

/** Solve a 3×3 linear system via Gaussian elimination with partial pivoting */
export function solveLinear3x3(A, b) {
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

/** Least-squares solve of A (n×3) · x = b via normal equations AᵀA x = Aᵀb */
export function solveLeastSquares3(A, b) {
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

// ---------------------------------------------------------------------------
// Affine transform
// ---------------------------------------------------------------------------

/**
 * Compute a 2×3 affine matrix from ≥3 pixel→mm point correspondences.
 * @param {{x:number, y:number}[]} pixelPoints  Crop-canvas pixel coords
 * @param {{x:number, y:number}[]} mmPoints     Paper mm coords
 * @returns {number[][]} [[a,b,c],[d,e,f]] where x_mm = a·px + b·py + c
 */
export function computeAffineTransform(pixelPoints, mmPoints) {
  const A = pixelPoints.map((p) => [p.x, p.y, 1]);
  const bx = mmPoints.map((p) => p.x);
  const by = mmPoints.map((p) => p.y);
  return [solveLeastSquares3(A, bx), solveLeastSquares3(A, by)];
}

/** Apply a 2×3 affine matrix to a pixel coordinate, returning mm {x, y} */
export function applyAffineTransform(matrix, px, py) {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  return { x: a * px + b * py + c, y: d * px + e * py + f };
}

// ---------------------------------------------------------------------------
// Spatial helpers
// ---------------------------------------------------------------------------

/** Euclidean distance between two {x, y} points */
export function distanceBetween(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Find the point farthest from all existing points.
 * Samples `numCandidates` random candidates and picks the one whose minimum
 * distance to any existing point is the largest.
 */
export function getFarthestPoint(points, width, height, numCandidates = 100) {
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
}

/**
 * Sort 4 dots into spatial order: [TL, TR, BL, BR].
 * Uses x+y sum (smallest = TL, largest = BR) and y-tiebreak for the middle two.
 */
export function sortDotsBySpatialOrder(dots) {
  const sorted = dots.slice().sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = sorted[0];
  const br = sorted[sorted.length - 1];
  const rest = sorted.slice(1, sorted.length - 1);
  const tr = rest[0].y <= rest[1].y ? rest[0] : rest[1];
  const bl = rest[0].y <= rest[1].y ? rest[1] : rest[0];
  return [tl, tr, bl, br];
}
