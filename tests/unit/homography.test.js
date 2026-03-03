import { describe, it, expect } from "vitest";
import {
  solveLinearSystem,
  getPerspectiveTransform,
  transformPoint,
} from "../../src/lib/homography.js";

describe("solveLinearSystem", () => {
  it("solves a 3×3 identity-coefficient system", () => {
    const A = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const b = [3, 7, 11];
    const x = solveLinearSystem(A, b);
    expect(x[0]).toBeCloseTo(3);
    expect(x[1]).toBeCloseTo(7);
    expect(x[2]).toBeCloseTo(11);
  });

  it("solves a non-trivial 3×3 system", () => {
    // 2x + y - z = 8
    // -3x - y + 2z = -11
    // -2x + y + 2z = -3
    // => x=2, y=3, z=-1
    const A = [
      [2, 1, -1],
      [-3, -1, 2],
      [-2, 1, 2],
    ];
    const b = [8, -11, -3];
    const x = solveLinearSystem(A, b);
    expect(x[0]).toBeCloseTo(2);
    expect(x[1]).toBeCloseTo(3);
    expect(x[2]).toBeCloseTo(-1);
  });

  it("solves a 2×2 system", () => {
    // x + 2y = 5
    // 3x + y = 5
    // => x=1, y=2
    const A = [
      [1, 2],
      [3, 1],
    ];
    const b = [5, 5];
    const x = solveLinearSystem(A, b);
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(2);
  });
});

describe("getPerspectiveTransform", () => {
  it("returns identity-like matrix when src == dst", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const matrix = getPerspectiveTransform(points, points);

    // Applying to any src point should return the same point
    for (const p of points) {
      const t = transformPoint(p.x, p.y, matrix);
      expect(t.x).toBeCloseTo(p.x, 4);
      expect(t.y).toBeCloseTo(p.y, 4);
    }
  });

  it("computes a 2× scale transform", () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];
    const matrix = getPerspectiveTransform(src, dst);

    const t1 = transformPoint(50, 50, matrix);
    expect(t1.x).toBeCloseTo(100, 4);
    expect(t1.y).toBeCloseTo(100, 4);

    const t2 = transformPoint(0, 0, matrix);
    expect(t2.x).toBeCloseTo(0, 4);
    expect(t2.y).toBeCloseTo(0, 4);

    const t3 = transformPoint(100, 100, matrix);
    expect(t3.x).toBeCloseTo(200, 4);
    expect(t3.y).toBeCloseTo(200, 4);
  });

  it("computes a translation transform", () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const dst = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 120 },
      { x: 10, y: 120 },
    ];
    const matrix = getPerspectiveTransform(src, dst);

    const t = transformPoint(50, 50, matrix);
    expect(t.x).toBeCloseTo(60, 4);
    expect(t.y).toBeCloseTo(70, 4);
  });

  it("maps all 4 source points to their destinations accurately", () => {
    // Trapezoid → rectangle (typical perspective correction)
    const src = [
      { x: 50, y: 30 },
      { x: 350, y: 50 },
      { x: 380, y: 270 },
      { x: 20, y: 250 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    const matrix = getPerspectiveTransform(src, dst);

    for (let i = 0; i < 4; i++) {
      const t = transformPoint(src[i].x, src[i].y, matrix);
      expect(t.x).toBeCloseTo(dst[i].x, 1);
      expect(t.y).toBeCloseTo(dst[i].y, 1);
    }
  });
});

describe("transformPoint", () => {
  it("applies a known 2× scale + offset matrix", () => {
    // Affine-like matrix: scale 2×, offset +10,+20, no perspective
    // [2, 0, 10, 0, 2, 20, 0, 0, 1]
    const matrix = [2, 0, 10, 0, 2, 20, 0, 0, 1];
    const t = transformPoint(5, 7, matrix);
    expect(t.x).toBeCloseTo(20); // 2*5 + 0*7 + 10 = 20
    expect(t.y).toBeCloseTo(34); // 0*5 + 2*7 + 20 = 34
  });

  it("handles the origin with an identity matrix", () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const t = transformPoint(0, 0, identity);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(0);
  });

  it("correctly divides by the projective denominator", () => {
    // matrix where h31, h32 are non-zero (actual perspective)
    // [1, 0, 0, 0, 1, 0, 0.001, 0, 1]
    const matrix = [1, 0, 0, 0, 1, 0, 0.001, 0, 1];
    const t = transformPoint(100, 50, matrix);
    // denom = 0.001*100 + 0*50 + 1 = 1.1
    // x = (100 + 0 + 0) / 1.1 ≈ 90.909
    // y = (0 + 50 + 0) / 1.1 ≈ 45.455
    expect(t.x).toBeCloseTo(90.909, 2);
    expect(t.y).toBeCloseTo(45.455, 2);
  });
});
