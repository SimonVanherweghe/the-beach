import { describe, it, expect } from "vitest";
import {
  solveLinear3x3,
  solveLeastSquares3,
  computeAffineTransform,
  applyAffineTransform,
} from "../../src/lib/geometry.js";

describe("solveLinear3x3", () => {
  it("solves a simple identity system", () => {
    // I · x = [1, 2, 3]
    const A = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const b = [1, 2, 3];
    const x = solveLinear3x3(A, b);
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(2);
    expect(x[2]).toBeCloseTo(3);
  });

  it("solves a non-trivial system", () => {
    // 2x + y = 5, x + 3y = 10, z = 7  (extended to 3×3 with z decoupled)
    // Full system: 2x + y + 0z = 5, x + 3y + 0z = 10, 0x + 0y + 1z = 7
    // Solution: x = 1, y = 3, z = 7
    const A = [
      [2, 1, 0],
      [1, 3, 0],
      [0, 0, 1],
    ];
    const b = [5, 10, 7];
    const x = solveLinear3x3(A, b);
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(3);
    expect(x[2]).toBeCloseTo(7);
  });
});

describe("solveLeastSquares3", () => {
  it("exact fit with 3 points reproduces known coefficients", () => {
    // f(x, y) = 2x + 3y + 5 → build A = [[x,y,1], ...], b = [f, ...]
    const points = [
      { x: 0, y: 0, f: 5 },
      { x: 1, y: 0, f: 7 },
      { x: 0, y: 1, f: 8 },
    ];
    const A = points.map((p) => [p.x, p.y, 1]);
    const b = points.map((p) => p.f);
    const [a, bCoeff, c] = solveLeastSquares3(A, b);
    expect(a).toBeCloseTo(2);
    expect(bCoeff).toBeCloseTo(3);
    expect(c).toBeCloseTo(5);
  });

  it("overdetermined system (4 points) still fits exactly when data is consistent", () => {
    // f(x, y) = 0.5x - 0.3y + 10
    const coeff = [0.5, -0.3, 10];
    const data = [
      [0, 0],
      [100, 0],
      [0, 200],
      [100, 200],
    ];
    const A = data.map(([x, y]) => [x, y, 1]);
    const b = data.map(([x, y]) => coeff[0] * x + coeff[1] * y + coeff[2]);
    const result = solveLeastSquares3(A, b);
    expect(result[0]).toBeCloseTo(0.5, 5);
    expect(result[1]).toBeCloseTo(-0.3, 5);
    expect(result[2]).toBeCloseTo(10, 5);
  });
});

describe("computeAffineTransform + applyAffineTransform", () => {
  // Use the actual A6 calibration setup:
  // Crop canvas: 400×300 pixels
  // Paper: 105×148 mm
  // Calibration dots at 10%/90% of paper corners
  const pixelPoints = [
    { x: 40, y: 30 }, // TL (10% of 400, 10% of 300)
    { x: 360, y: 30 }, // TR
    { x: 40, y: 270 }, // BL
    { x: 360, y: 270 }, // BR
  ];
  const mmPoints = [
    { x: 10.5, y: 14.8 }, // TL
    { x: 94.5, y: 14.8 }, // TR
    { x: 10.5, y: 133.2 }, // BL
    { x: 94.5, y: 133.2 }, // BR
  ];

  const matrix = computeAffineTransform(pixelPoints, mmPoints);

  it("round-trips all 4 calibration points within 0.1 mm", () => {
    for (let i = 0; i < 4; i++) {
      const result = applyAffineTransform(
        matrix,
        pixelPoints[i].x,
        pixelPoints[i].y,
      );
      expect(result.x).toBeCloseTo(mmPoints[i].x, 1);
      expect(result.y).toBeCloseTo(mmPoints[i].y, 1);
    }
  });

  it("maps center pixel to roughly center of paper", () => {
    const center = applyAffineTransform(matrix, 200, 150);
    expect(center.x).toBeCloseTo(52.5, 0); // 105/2
    expect(center.y).toBeCloseTo(74, 0); // 148/2
  });

  it("maps origin pixel (0,0) to expected extrapolated mm", () => {
    // With a purely linear mapping, (0,0) should be slightly outside the paper
    const origin = applyAffineTransform(matrix, 0, 0);
    // It should be near 0 mm (slightly negative if offset is small)
    expect(origin.x).toBeLessThan(15);
    expect(origin.y).toBeLessThan(20);
  });
});
