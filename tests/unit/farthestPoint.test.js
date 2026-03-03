import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFarthestPoint, distanceBetween } from "../../src/lib/geometry.js";

describe("distanceBetween", () => {
  it("returns 0 for identical points", () => {
    expect(distanceBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("returns correct distance for a 3-4-5 triangle", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
  });

  it("works with negative coordinates", () => {
    expect(distanceBetween({ x: -3, y: -4 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });

  it("is commutative", () => {
    const a = { x: 10, y: 20 };
    const b = { x: 30, y: 50 };
    expect(distanceBetween(a, b)).toBeCloseTo(distanceBetween(b, a));
  });
});

describe("getFarthestPoint", () => {
  let randomMock;

  beforeEach(() => {
    // Seed Math.random with a deterministic sequence
    let callIndex = 0;
    const sequence = [];
    // Pre-fill 200 values (100 candidates × 2 coords)
    for (let i = 0; i < 200; i++) {
      sequence.push(((i * 7 + 3) % 200) / 200); // pseudo-deterministic spread
    }
    randomMock = vi
      .spyOn(Math, "random")
      .mockImplementation(() => sequence[callIndex++ % sequence.length]);
  });

  afterEach(() => {
    randomMock.mockRestore();
  });

  it("returns a point within bounds when no existing points", () => {
    const result = getFarthestPoint([], 400, 300);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x).toBeLessThanOrEqual(400);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeLessThanOrEqual(300);
  });

  it("returns a point within bounds with existing points", () => {
    const existing = [
      { x: 200, y: 150 },
      { x: 50, y: 50 },
    ];
    const result = getFarthestPoint(existing, 400, 300);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x).toBeLessThanOrEqual(400);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeLessThanOrEqual(300);
  });

  it("maximises minimum distance to existing points", () => {
    const existing = [{ x: 100, y: 100 }];
    const result = getFarthestPoint(existing, 400, 300);

    // The chosen point's min-distance to existing points should be
    // reasonably large (at least half the canvas diagonal / 4)
    const minDist = distanceBetween(result, existing[0]);
    expect(minDist).toBeGreaterThan(50);
  });

  it("avoids the single existing point", () => {
    const existing = [{ x: 200, y: 150 }];
    const result = getFarthestPoint(existing, 400, 300);

    // Should not land exactly on top of the existing point
    const dist = distanceBetween(result, existing[0]);
    expect(dist).toBeGreaterThan(10);
  });

  it("returns a point far from a cluster in the center", () => {
    const cluster = [
      { x: 190, y: 140 },
      { x: 200, y: 150 },
      { x: 210, y: 160 },
    ];
    const result = getFarthestPoint(cluster, 400, 300);

    // Should be far from the cluster center area
    const minDist = Math.min(...cluster.map((p) => distanceBetween(result, p)));
    expect(minDist).toBeGreaterThan(50);
  });
});
