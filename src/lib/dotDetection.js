/**
 * Dot detection helpers.
 * Extracted from src/main.js so they can be tested independently.
 *
 * All functions are pure (or only mutate caller-supplied buffers).
 * Constants are passed in via an options object so tests can override them.
 */

/** Default detection options (match the values in main.js) */
export const DEFAULT_OPTIONS = {
  threshold: 100, // brightness cutoff 0-255
  minDotSize: 5,
  maxDotSize: 200,
  positionTolerance: 3,
};

/**
 * Flood fill (iterative, 4-connected) on a binary mask.
 * Mutates `visited`. Returns { size, sumX, sumY }.
 */
export function floodFill(mask, visited, startX, startY, width, height) {
  const stack = [{ x: startX, y: startY }];
  let size = 0;
  let sumX = 0;
  let sumY = 0;

  while (stack.length > 0) {
    const { x, y } = stack.pop();
    const index = y * width + x;

    if (
      x < 0 ||
      x >= width ||
      y < 0 ||
      y >= height ||
      visited[index] === 1 ||
      mask[index] === 0
    ) {
      continue;
    }

    visited[index] = 1;
    size++;
    sumX += x;
    sumY += y;

    stack.push({ x: x + 1, y: y });
    stack.push({ x: x - 1, y: y });
    stack.push({ x: x, y: y + 1 });
    stack.push({ x: x, y: y - 1 });
  }

  return { size, sumX, sumY };
}

/**
 * Detect dark dots in an ImageData-compatible object.
 * @param {{ data: Uint8ClampedArray|Uint8Array, width: number, height: number }} imageData
 * @param {object} [opts]  Override DEFAULT_OPTIONS selectively
 * @returns {{ x: number, y: number, size: number, realX: number, realY: number }[]}
 */
export function detectDots(imageData, opts = {}) {
  const { threshold, minDotSize, maxDotSize } = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };

  const dots = [];
  const { data, width, height } = imageData;

  // Build binary mask
  const binaryMask = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    binaryMask[Math.floor(i / 4)] = gray < threshold ? 1 : 0;
  }

  // Connected-component labelling
  const visited = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (binaryMask[index] === 1 && visited[index] === 0) {
        const component = floodFill(binaryMask, visited, x, y, width, height);
        if (component.size >= minDotSize && component.size <= maxDotSize) {
          const centerX = component.sumX / component.size;
          const centerY = component.sumY / component.size;
          dots.push({
            x: Math.round(centerX),
            y: Math.round(centerY),
            size: component.size,
            realX: centerX,
            realY: centerY,
          });
        }
      }
    }
  }

  return dots;
}

/**
 * Check if two dot arrays differ beyond a tolerance.
 * @param {{x:number, y:number}[]} newDots
 * @param {{x:number, y:number}[]} oldDots
 * @param {number} [tolerance]
 * @returns {boolean}
 */
export function dotsHaveChanged(
  newDots,
  oldDots,
  tolerance = DEFAULT_OPTIONS.positionTolerance,
) {
  if (newDots.length !== oldDots.length) return true;

  const sortDots = (dots) =>
    dots.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const sortedNew = sortDots(newDots);
  const sortedOld = sortDots(oldDots);

  for (let i = 0; i < sortedNew.length; i++) {
    if (
      Math.abs(sortedNew[i].x - sortedOld[i].x) > tolerance ||
      Math.abs(sortedNew[i].y - sortedOld[i].y) > tolerance
    ) {
      return true;
    }
  }

  return false;
}
