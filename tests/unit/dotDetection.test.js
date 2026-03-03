import { describe, it, expect } from "vitest";
import {
  floodFill,
  detectDots,
  dotsHaveChanged,
} from "../../src/lib/dotDetection.js";

// Helper: create a blank (white) RGBA image buffer
function createWhiteImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255); // all white, full alpha
  return { data, width, height };
}

// Helper: paint a filled square of black pixels on an image
function paintBlackSquare(imageData, sx, sy, size) {
  const { data, width } = imageData;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = sx + dx;
      const py = sy + dy;
      if (px < width && py < imageData.height) {
        const i = (py * width + px) * 4;
        data[i] = 0; // R
        data[i + 1] = 0; // G
        data[i + 2] = 0; // B
        // A stays 255
      }
    }
  }
}

describe("floodFill", () => {
  it("finds a single connected region", () => {
    // 5×5 grid with a 3×1 horizontal bar at row 2
    const w = 5,
      h = 5;
    const mask = new Uint8Array(w * h);
    mask[2 * w + 1] = 1;
    mask[2 * w + 2] = 1;
    mask[2 * w + 3] = 1;

    const visited = new Uint8Array(w * h);
    const result = floodFill(mask, visited, 1, 2, w, h);

    expect(result.size).toBe(3);
    expect(result.sumX).toBe(1 + 2 + 3);
    expect(result.sumY).toBe(2 + 2 + 2);
  });

  it("returns size 0 if start pixel is not in the mask", () => {
    const w = 5,
      h = 5;
    const mask = new Uint8Array(w * h); // all zeros
    const visited = new Uint8Array(w * h);
    const result = floodFill(mask, visited, 2, 2, w, h);
    expect(result.size).toBe(0);
  });

  it("handles an L-shaped region", () => {
    const w = 5,
      h = 5;
    const mask = new Uint8Array(w * h);
    // Vertical bar
    mask[0 * w + 1] = 1;
    mask[1 * w + 1] = 1;
    mask[2 * w + 1] = 1;
    // Horizontal bar extending from bottom of vertical
    mask[2 * w + 2] = 1;
    mask[2 * w + 3] = 1;

    const visited = new Uint8Array(w * h);
    const result = floodFill(mask, visited, 1, 0, w, h);

    expect(result.size).toBe(5);
  });
});

describe("detectDots", () => {
  it("detects a single black dot on a white background", () => {
    const img = createWhiteImage(50, 50);
    // Paint a 6×6 black square at (20, 20) — area = 36, within [5, 200]
    paintBlackSquare(img, 20, 20, 6);

    const dots = detectDots(img);
    expect(dots).toHaveLength(1);
    // 6×6 square at (20,20): centroid = (22.5, 22.5) → Math.round → 23
    expect(dots[0].x).toBe(23);
    expect(dots[0].y).toBe(23);
    expect(dots[0].size).toBe(36);
  });

  it("detects two separated dots", () => {
    const img = createWhiteImage(100, 50);
    paintBlackSquare(img, 5, 5, 6); // dot 1
    paintBlackSquare(img, 80, 5, 6); // dot 2

    const dots = detectDots(img);
    expect(dots).toHaveLength(2);
  });

  it("filters out dots smaller than minDotSize", () => {
    const img = createWhiteImage(50, 50);
    // Paint a 2×2 square (area = 4, below default minDotSize of 5)
    paintBlackSquare(img, 20, 20, 2);

    const dots = detectDots(img);
    expect(dots).toHaveLength(0);
  });

  it("filters out dots larger than maxDotSize", () => {
    const img = createWhiteImage(50, 50);
    // Paint a 15×15 square (area = 225, above default maxDotSize of 200)
    paintBlackSquare(img, 5, 5, 15);

    const dots = detectDots(img);
    expect(dots).toHaveLength(0);
  });

  it("respects custom threshold option", () => {
    const img = createWhiteImage(50, 50);
    // Paint dark gray pixels (value 80) — below default threshold of 100
    const { data, width } = img;
    for (let dy = 0; dy < 6; dy++) {
      for (let dx = 0; dx < 6; dx++) {
        const i = ((20 + dy) * width + (20 + dx)) * 4;
        data[i] = 80;
        data[i + 1] = 80;
        data[i + 2] = 80;
      }
    }

    // With default threshold (100), should detect it
    expect(detectDots(img)).toHaveLength(1);

    // With lower threshold (50), should NOT detect it (80 >= 50)
    expect(detectDots(img, { threshold: 50 })).toHaveLength(0);
  });

  it("returns empty array for all-white image", () => {
    const img = createWhiteImage(100, 100);
    expect(detectDots(img)).toHaveLength(0);
  });

  it("returns empty array for all-black image (single blob too large)", () => {
    // 20×20 = 400 pixels, above default maxDotSize of 200
    const img = createWhiteImage(20, 20);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
    }
    expect(detectDots(img)).toHaveLength(0);
  });
});

describe("dotsHaveChanged", () => {
  it("returns true when dot counts differ", () => {
    expect(dotsHaveChanged([{ x: 1, y: 1 }], [])).toBe(true);
  });

  it("returns false for identical dot arrays", () => {
    const dots = [
      { x: 10, y: 20 },
      { x: 50, y: 60 },
    ];
    expect(dotsHaveChanged(dots, dots)).toBe(false);
  });

  it("returns false when dots are within tolerance", () => {
    const a = [{ x: 10, y: 20 }];
    const b = [{ x: 12, y: 22 }]; // delta 2, within default tolerance 3
    expect(dotsHaveChanged(a, b)).toBe(false);
  });

  it("returns true when dots exceed tolerance", () => {
    const a = [{ x: 10, y: 20 }];
    const b = [{ x: 14, y: 20 }]; // delta 4, beyond default tolerance 3
    expect(dotsHaveChanged(a, b)).toBe(true);
  });

  it("is insensitive to order (sorts before comparing)", () => {
    const a = [
      { x: 10, y: 20 },
      { x: 50, y: 60 },
    ];
    const b = [
      { x: 50, y: 60 },
      { x: 10, y: 20 },
    ];
    expect(dotsHaveChanged(a, b)).toBe(false);
  });

  it("respects custom tolerance parameter", () => {
    const a = [{ x: 10, y: 20 }];
    const b = [{ x: 14, y: 20 }]; // delta 4
    // With tolerance 5, should be considered the same
    expect(dotsHaveChanged(a, b, 5)).toBe(false);
    // With tolerance 3, should be different
    expect(dotsHaveChanged(a, b, 3)).toBe(true);
  });
});
