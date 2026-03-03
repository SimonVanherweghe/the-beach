import { describe, it, expect } from "vitest";
import { sortDotsBySpatialOrder } from "../../src/lib/geometry.js";

describe("sortDotsBySpatialOrder", () => {
  it("sorts 4 axis-aligned corner dots into TL, TR, BL, BR", () => {
    // Scrambled order: BR, TL, BL, TR
    const dots = [
      { x: 350, y: 260 },
      { x: 40, y: 30 },
      { x: 40, y: 260 },
      { x: 350, y: 30 },
    ];
    const [tl, tr, bl, br] = sortDotsBySpatialOrder(dots);

    expect(tl).toEqual({ x: 40, y: 30 });
    expect(tr).toEqual({ x: 350, y: 30 });
    expect(bl).toEqual({ x: 40, y: 260 });
    expect(br).toEqual({ x: 350, y: 260 });
  });

  it("handles already-sorted input", () => {
    const dots = [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 10, y: 90 },
      { x: 90, y: 90 },
    ];
    const [tl, tr, bl, br] = sortDotsBySpatialOrder(dots);

    expect(tl).toEqual({ x: 10, y: 10 });
    expect(tr).toEqual({ x: 90, y: 10 });
    expect(bl).toEqual({ x: 10, y: 90 });
    expect(br).toEqual({ x: 90, y: 90 });
  });

  it("distinguishes TR from BL when x+y sums are close", () => {
    // TR has high x, low y; BL has low x, high y
    // Their x+y might be similar — the y-tiebreak matters
    const dots = [
      { x: 5, y: 5 }, // TL (sum 10)
      { x: 95, y: 15 }, // TR (sum 110)
      { x: 15, y: 95 }, // BL (sum 110 — same!)
      { x: 95, y: 95 }, // BR (sum 190)
    ];
    const [tl, tr, bl, br] = sortDotsBySpatialOrder(dots);

    expect(tl).toEqual({ x: 5, y: 5 });
    expect(tr).toEqual({ x: 95, y: 15 }); // smaller y → TR
    expect(bl).toEqual({ x: 15, y: 95 }); // larger y → BL
    expect(br).toEqual({ x: 95, y: 95 });
  });

  it("does not mutate the input array", () => {
    const dots = [
      { x: 350, y: 260 },
      { x: 40, y: 30 },
      { x: 40, y: 260 },
      { x: 350, y: 30 },
    ];
    const original = JSON.stringify(dots);
    sortDotsBySpatialOrder(dots);
    expect(JSON.stringify(dots)).toBe(original);
  });

  it("handles slightly rotated dots", () => {
    // Simulating a slightly rotated paper where all dots are shifted
    const dots = [
      { x: 50, y: 20 }, // TL-ish
      { x: 380, y: 40 }, // TR-ish
      { x: 30, y: 250 }, // BL-ish
      { x: 360, y: 270 }, // BR-ish
    ];
    const [tl, tr, bl, br] = sortDotsBySpatialOrder(dots);

    expect(tl).toEqual({ x: 50, y: 20 });
    expect(tr).toEqual({ x: 380, y: 40 });
    expect(bl).toEqual({ x: 30, y: 250 });
    expect(br).toEqual({ x: 360, y: 270 });
  });
});
