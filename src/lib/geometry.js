/**
 * Affine transform and spatial geometry helpers.
 * Used by both server (index.mjs) and tests.
 */

import { Delaunay } from "d3-delaunay";

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
 * Circumcenter + circumradius of triangle (ax,ay)–(bx,by)–(cx,cy).
 * Returns { x, y, radius } or null if the triangle is degenerate.
 */
function circumcenterOf(ax, ay, bx, by, cx, cy) {
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return null;
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    D;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    D;
  return { x: ux, y: uy, radius: Math.hypot(ux - ax, uy - ay) };
}

/**
 * Find the point farthest from all existing points using Delaunay
 * triangulation. Computes the circumcenter of every Delaunay triangle and
 * returns the one with the largest circumradius that lies inside the safe
 * area — this is the center of the largest empty circle.
 *
 * Virtual border dots along each edge ensure circumcenters near borders
 * have small radii and naturally lose to interior candidates.
 */
export function getFarthestPoint(
  points,
  width,
  height,
  { margin = 0, numCandidates = 100, borderSamples = 40, bounds = null } = {},
) {
  // Safe area boundaries (inset by margin, or explicit bounds)
  const minX = bounds?.minX ?? margin;
  const minY = bounds?.minY ?? margin;
  const maxX = bounds?.maxX ?? width - margin;
  const maxY = bounds?.maxY ?? height - margin;
  const safeW = maxX - minX;
  const safeH = maxY - minY;

  const fallback = { x: minX + safeW / 2, y: minY + safeH / 2 };
  if (safeW <= 0 || safeH <= 0) return fallback;

  // Build virtual border dots along the safe-area edges
  const borderPoints = [];
  for (let i = 0; i < borderSamples; i++) {
    const t = i / (borderSamples - 1);
    borderPoints.push({ x: minX + t * safeW, y: minY }); // top
    borderPoints.push({ x: minX + t * safeW, y: maxY }); // bottom
    borderPoints.push({ x: minX, y: minY + t * safeH }); // left
    borderPoints.push({ x: maxX, y: minY + t * safeH }); // right
  }

  const allPoints = [...points, ...borderPoints];

  // Need at least 3 non-collinear points for triangulation
  if (allPoints.length < 3) return fallback;

  // Delaunay triangulation
  const coords = allPoints.flatMap((p) => [p.x, p.y]);
  const delaunay = new Delaunay(coords);
  const { triangles } = delaunay;

  let bestPoint = null;
  let bestRadius = -1;

  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i];
    const b = triangles[i + 1];
    const c = triangles[i + 2];
    const cc = circumcenterOf(
      coords[a * 2],
      coords[a * 2 + 1],
      coords[b * 2],
      coords[b * 2 + 1],
      coords[c * 2],
      coords[c * 2 + 1],
    );
    if (!cc) continue;
    // Must lie inside the safe area
    if (cc.x < minX || cc.x > maxX || cc.y < minY || cc.y > maxY) continue;
    if (cc.radius > bestRadius) {
      bestRadius = cc.radius;
      bestPoint = { x: cc.x, y: cc.y };
    }
  }

  return bestPoint ?? fallback;
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
