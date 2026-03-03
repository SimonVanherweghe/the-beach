/**
 * Perspective (homography) transform helpers.
 * Extracted from src/main.js so they can be tested independently.
 */

/**
 * Gaussian elimination solver for an n×n linear system.
 * @param {number[][]} A  n×n coefficient matrix
 * @param {number[]}   b  n-element right-hand side
 * @returns {number[]}    n-element solution vector
 */
export function solveLinearSystem(A, b) {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j < n + 1; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }

  // Back substitution
  const solution = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    solution[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      solution[i] -= augmented[i][j] * solution[j];
    }
    solution[i] /= augmented[i][i];
  }

  return solution;
}

/**
 * Compute the 3×3 homography (perspective transform) matrix from
 * 4 source points to 4 destination points.
 * Returns a 9-element flat array [h11, h12, h13, h21, h22, h23, h31, h32, h33].
 */
export function getPerspectiveTransform(src, dst) {
  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);

    b.push(dx);
    b.push(dy);
  }

  const matrix = solveLinearSystem(A, b);
  matrix.push(1); // h33 = 1
  return matrix;
}

/**
 * Apply a homography matrix to a single point.
 * @param {number} x
 * @param {number} y
 * @param {number[]} matrix  9-element flat homography
 * @returns {{x: number, y: number}}
 */
export function transformPoint(x, y, matrix) {
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = matrix;

  const denominator = h31 * x + h32 * y + h33;
  const newX = (h11 * x + h12 * y + h13) / denominator;
  const newY = (h21 * x + h22 * y + h23) / denominator;

  return { x: newX, y: newY };
}
