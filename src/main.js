import "./style.css"; // Import styles
import { io } from "socket.io-client";

// Get DOM elements
const canvas = document.getElementById("canvas");
const cropCanvas = document.getElementById("crop-canvas");
const ctx = canvas.getContext("2d");
const cropCtx = cropCanvas.getContext("2d");
const webcamSelect = document.getElementById("webcam-select");
let video, socket;
let currentStream = null;

// Rectangle corner points - starts with default values
let corners = [
  { x: 100, y: 100 }, // top-left
  { x: 500, y: 100 }, // top-right
  { x: 500, y: 400 }, // bottom-right
  { x: 100, y: 400 }, // bottom-left
];
let activeCornerIndex = -1; // -1 means no corner is active
const cornerRadius = 10; // radius of corner handles for interaction

// Add variables to track the video display area
let videoDisplayRect = { x: 0, y: 0, width: 0, height: 0 };

// Perspective transformation variables
const TRANSFORM_WIDTH = 400; // Width of the transformed output
const TRANSFORM_HEIGHT = 300; // Height of the transformed output

// Dot detection variables
let detectedDots = [];
let dotDetectionEnabled = true;
const DOT_DETECTION_THRESHOLD = 100; // Brightness threshold (0-255)
const MIN_DOT_SIZE = 5; // Minimum dot area in pixels
const MAX_DOT_SIZE = 200; // Maximum dot area in pixels

// Motion detection and caching variables
let lastVideoFrame = null;
let cachedTransformedImage = null;
let cornersChanged = true;
let lastCorners = null;
const MOTION_THRESHOLD = 5000; // Threshold for detecting motion
const FRAME_DIFF_SAMPLE_RATE = 4; // Sample every 4th pixel for performance

// Dot logging debounce variables
let lastDetectedDots = [];
let lastDotLogTime = 0;
const DOT_LOG_DEBOUNCE_MS = 2000; // Only log every 2 seconds
const DOT_POSITION_TOLERANCE = 3; // Pixels tolerance for considering dots "same"

const initSocket = () => {
  socket = io.connect("/");
  socket.on("connect", () => {
    console.log(`Connected: ${socket.id}`);
  });
};

// Set up the canvases size
function setupCanvas() {
  // Get the size of the canvas wrapper
  const wrappers = document.querySelectorAll(".canvas-wrapper");
  if (wrappers.length < 2) return;

  const leftWrapper = wrappers[0];
  const rightWrapper = wrappers[1];

  // Set canvas sizes based on their containers
  canvas.width = leftWrapper.clientWidth;
  canvas.height = leftWrapper.clientHeight;
  cropCanvas.width = rightWrapper.clientWidth;
  cropCanvas.height = rightWrapper.clientHeight;

  // We'll update the rectangle during video rendering
  // when we know the actual video dimensions
}

// Populate webcam selection dropdown
async function getAvailableWebcams() {
  webcamSelect.innerHTML = "";

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(
      (device) => device.kind === "videoinput"
    );

    if (videoDevices.length === 0) {
      const option = document.createElement("option");
      option.text = "No webcams found";
      webcamSelect.add(option);
      return false;
    }

    // Add each video device to the select element
    let externalCamIndex = -1;
    let builtInCamIndex = -1;

    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Webcam ${index + 1}`;
      webcamSelect.add(option);

      // Try to identify built-in cameras
      const label = device.label.toLowerCase();
      if (
        label.includes("built-in") ||
        label.includes("internal") ||
        label.includes("facetime") ||
        label.includes("integrated")
      ) {
        builtInCamIndex = index;
      } else if (externalCamIndex === -1) {
        // Mark the first non-built-in camera
        externalCamIndex = index;
      }
    });

    // Select an external camera by default if available
    if (externalCamIndex !== -1) {
      webcamSelect.selectedIndex = externalCamIndex;
    } else if (videoDevices.length > 1 && builtInCamIndex !== -1) {
      // If we have multiple cameras but they're all built-in, select one that's not the first
      const alternativeIndex = builtInCamIndex === 0 ? 1 : 0;
      webcamSelect.selectedIndex = alternativeIndex;
    }

    // Add change event listener to select element
    webcamSelect.addEventListener("change", () => {
      // Stop current stream if it exists
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
      // Setup webcam with new device
      setupWebcam();
    });

    return true;
  } catch (error) {
    console.error("Error getting webcam devices:", error);
    return false;
  }
}

// Initialize the webcam
async function setupWebcam() {
  if (!video) {
    video = document.createElement("video");
  }

  try {
    // Get the selected webcam deviceId
    const deviceId = webcamSelect.value;

    // Request access to the webcam with selected device
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;

    // Connect the webcam stream to the video element
    video.srcObject = stream;
    video.play();

    // If labels are empty, get them after user has granted permission
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(
      (device) => device.kind === "videoinput"
    );

    if (videoDevices.some((device) => !device.label)) {
      // Refresh device list now that we have permission
      getAvailableWebcams();
    }

    // Wait for the video to be ready
    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        resolve(video);
      };
    });
  } catch (error) {
    console.error("Error accessing the webcam:", error);
  }
}

// Draw the rectangle overlay
function drawRectangleOverlay() {
  if (corners.length !== 4) return;

  // Draw the rectangle lines
  ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Draw the corner handles
  corners.forEach((corner, index) => {
    ctx.fillStyle =
      index === activeCornerIndex
        ? "rgba(255, 255, 0, 0.8)"
        : "rgba(255, 0, 0, 0.8)";
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, cornerRadius, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Perspective transformation function
function getPerspectiveTransform(src, dst) {
  // src and dst are arrays of 4 points: [{x, y}, {x, y}, {x, y}, {x, y}]
  // This creates a transformation matrix from source quadrilateral to destination rectangle

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

  // Solve the linear system using Gaussian elimination
  const matrix = solveLinearSystem(A, b);
  matrix.push(1); // h33 = 1

  return matrix;
}

// Simple Gaussian elimination solver
function solveLinearSystem(A, b) {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);

  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    // Eliminate
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

// Apply perspective transformation to a point
function transformPoint(x, y, matrix) {
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = matrix;

  const denominator = h31 * x + h32 * y + h33;
  const newX = (h11 * x + h12 * y + h13) / denominator;
  const newY = (h21 * x + h22 * y + h23) / denominator;

  return { x: newX, y: newY };
}

// Detect black dots in the transformed image
function detectDots(imageData) {
  const dots = [];
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // Create a binary mask for black pixels
  const binaryMask = new Uint8Array(width * height);

  // Convert to grayscale and threshold
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Convert to grayscale
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // Threshold to detect dark pixels
    const pixelIndex = Math.floor(i / 4);
    binaryMask[pixelIndex] = gray < DOT_DETECTION_THRESHOLD ? 1 : 0;
  }

  // Find connected components (dots)
  const visited = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      if (binaryMask[index] === 1 && visited[index] === 0) {
        // Found a new dark region - flood fill to find its size and center
        const component = floodFill(binaryMask, visited, x, y, width, height);

        if (component.size >= MIN_DOT_SIZE && component.size <= MAX_DOT_SIZE) {
          // Calculate center of mass
          const centerX = component.sumX / component.size;
          const centerY = component.sumY / component.size;

          dots.push({
            x: Math.round(centerX),
            y: Math.round(centerY),
            size: component.size,
            // Convert to real-world coordinates if needed
            realX: centerX,
            realY: centerY,
          });
        }
      }
    }
  }

  return dots;
}

// Flood fill algorithm to find connected components
function floodFill(mask, visited, startX, startY, width, height) {
  const stack = [{ x: startX, y: startY }];
  let size = 0;
  let sumX = 0;
  let sumY = 0;

  while (stack.length > 0) {
    const { x, y } = stack.pop();
    const index = y * width + x;

    // Check bounds and if already visited
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

    // Mark as visited
    visited[index] = 1;
    size++;
    sumX += x;
    sumY += y;

    // Add neighbors to stack
    stack.push({ x: x + 1, y: y });
    stack.push({ x: x - 1, y: y });
    stack.push({ x: x, y: y + 1 });
    stack.push({ x: x, y: y - 1 });
  }

  return { size, sumX, sumY };
}

// Draw detected dots overlay
function drawDotsOverlay() {
  if (!dotDetectionEnabled || detectedDots.length === 0) return;

  // Draw on the crop canvas
  cropCtx.save();

  // Calculate the position of the transformed image
  const centerX = (cropCanvas.width - TRANSFORM_WIDTH) / 2;
  const centerY = (cropCanvas.height - TRANSFORM_HEIGHT) / 2;

  detectedDots.forEach((dot, index) => {
    // Draw dot marker
    cropCtx.strokeStyle = "red";
    cropCtx.fillStyle = "rgba(255, 0, 0, 0.7)";
    cropCtx.lineWidth = 2;

    const dotX = centerX + dot.x;
    const dotY = centerY + dot.y;

    // Draw circle around detected dot
    cropCtx.beginPath();
    cropCtx.arc(dotX, dotY, 8, 0, Math.PI * 2);
    cropCtx.stroke();

    // Draw center point
    cropCtx.beginPath();
    cropCtx.arc(dotX, dotY, 2, 0, Math.PI * 2);
    cropCtx.fill();

    // Draw label with coordinates
    cropCtx.fillStyle = "red";
    cropCtx.font = "12px Arial";
    cropCtx.fillText(`(${dot.x}, ${dot.y})`, dotX + 10, dotY - 10);
  });

  cropCtx.restore();
}

// Check if detected dots have significantly changed
function dotsHaveChanged(newDots, oldDots) {
  if (newDots.length !== oldDots.length) return true;

  // Sort dots by position for comparison
  const sortDots = (dots) =>
    dots.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const sortedNew = sortDots(newDots);
  const sortedOld = sortDots(oldDots);

  for (let i = 0; i < sortedNew.length; i++) {
    const deltaX = Math.abs(sortedNew[i].x - sortedOld[i].x);
    const deltaY = Math.abs(sortedNew[i].y - sortedOld[i].y);

    if (deltaX > DOT_POSITION_TOLERANCE || deltaY > DOT_POSITION_TOLERANCE) {
      return true;
    }
  }

  return false;
}

// Log detected dots to console with debouncing
function logDetectedDots() {
  if (detectedDots.length === 0 && lastDetectedDots.length === 0) {
    return; // No dots detected and no previous dots
  }

  const currentTime = Date.now();
  const timeSinceLastLog = currentTime - lastDotLogTime;

  // Check if enough time has passed and dots have changed
  const dotsChanged = dotsHaveChanged(detectedDots, lastDetectedDots);

  if (timeSinceLastLog >= DOT_LOG_DEBOUNCE_MS && dotsChanged) {
    if (detectedDots.length > 0) {
      console.log(
        "Detected dots:",
        detectedDots.map((dot) => ({
          x: dot.x,
          y: dot.y,
          size: dot.size,
        }))
      );
      if (socket && socket.connected) {
        socket.emit("detectedDots", detectedDots);
      }
    } else {
      console.log("No dots detected");
    }

    lastDetectedDots = JSON.parse(JSON.stringify(detectedDots));
    lastDotLogTime = currentTime;
  }
}

// Check if corners have changed
function checkCornersChanged() {
  if (!lastCorners) {
    lastCorners = JSON.parse(JSON.stringify(corners));
    cornersChanged = true;
    return true;
  }

  for (let i = 0; i < corners.length; i++) {
    if (
      Math.abs(corners[i].x - lastCorners[i].x) > 1 ||
      Math.abs(corners[i].y - lastCorners[i].y) > 1
    ) {
      lastCorners = JSON.parse(JSON.stringify(corners));
      cornersChanged = true;
      return true;
    }
  }

  cornersChanged = false;
  return false;
}

// Detect motion in the source video
function detectMotion(currentImageData) {
  const currentData = currentImageData.data;

  // If we don't have a previous frame or the size changed, initialize
  if (!lastVideoFrame || lastVideoFrame.length !== currentData.length) {
    lastVideoFrame = new Uint8Array(currentData);
    return true; // First frame or size changed, assume motion
  }

  let totalDifference = 0;
  let sampleCount = 0;

  // Sample every FRAME_DIFF_SAMPLE_RATE pixels for performance
  for (let i = 0; i < currentData.length; i += 4 * FRAME_DIFF_SAMPLE_RATE) {
    if (i + 2 < currentData.length && i + 2 < lastVideoFrame.length) {
      const currentGray =
        0.299 * currentData[i] +
        0.587 * currentData[i + 1] +
        0.114 * currentData[i + 2];
      const lastGray =
        0.299 * lastVideoFrame[i] +
        0.587 * lastVideoFrame[i + 1] +
        0.114 * lastVideoFrame[i + 2];

      totalDifference += Math.abs(currentGray - lastGray);
      sampleCount++;
    }
  }

  // Update last frame with proper size check
  if (lastVideoFrame.length === currentData.length) {
    lastVideoFrame.set(currentData);
  } else {
    lastVideoFrame = new Uint8Array(currentData);
  }

  if (sampleCount === 0) return true; // No valid samples, assume motion

  const averageDifference = totalDifference / sampleCount;
  return averageDifference > MOTION_THRESHOLD / sampleCount;
}

// Get video frame data for motion detection (only the selected area)
function getSelectedAreaImageData() {
  // Create a temporary canvas for the selected area
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d");

  // Calculate bounding box of selected area
  const minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
  const maxX = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
  const minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
  const maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);

  const areaWidth = maxX - minX;
  const areaHeight = maxY - minY;

  tempCanvas.width = areaWidth;
  tempCanvas.height = areaHeight;

  // Draw only the selected area
  const scaleX = video.videoWidth / videoDisplayRect.width;
  const scaleY = video.videoHeight / videoDisplayRect.height;

  const sourceX = (minX - videoDisplayRect.x) * scaleX;
  const sourceY = (minY - videoDisplayRect.y) * scaleY;
  const sourceW = areaWidth * scaleX;
  const sourceH = areaHeight * scaleY;

  tempCtx.drawImage(
    video,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    areaWidth,
    areaHeight
  );

  return tempCtx.getImageData(0, 0, areaWidth, areaHeight);
}

// Transform the video content using perspective correction
function drawTransformedView() {
  if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;

  // Check if corners have changed
  const cornersHaveChanged = checkCornersChanged();

  // Get current video data for motion detection
  const currentImageData = getSelectedAreaImageData();
  const hasMotion = detectMotion(currentImageData);

  // Only recalculate if corners changed or motion detected
  if (!cornersHaveChanged && !hasMotion && cachedTransformedImage) {
    // Use cached image
    const centerX = (cropCanvas.width - TRANSFORM_WIDTH) / 2;
    const centerY = (cropCanvas.height - TRANSFORM_HEIGHT) / 2;

    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(cachedTransformedImage, centerX, centerY);

    // Still draw dots overlay if enabled (but don't recalculate dots)
    if (dotDetectionEnabled) {
      drawDotsOverlay();
    }
    return;
  }

  // Define destination rectangle (flat view)
  const dst = [
    { x: 0, y: 0 }, // top-left
    { x: TRANSFORM_WIDTH, y: 0 }, // top-right
    { x: TRANSFORM_WIDTH, y: TRANSFORM_HEIGHT }, // bottom-right
    { x: 0, y: TRANSFORM_HEIGHT }, // bottom-left
  ];

  // Get transformation matrix from corners to destination rectangle
  const matrix = getPerspectiveTransform(dst, corners);

  // Clear the crop canvas
  cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

  // Calculate center position for the transformed image
  const centerX = (cropCanvas.width - TRANSFORM_WIDTH) / 2;
  const centerY = (cropCanvas.height - TRANSFORM_HEIGHT) / 2;

  // Create temporary canvas for the transformation
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = TRANSFORM_WIDTH;
  tempCanvas.height = TRANSFORM_HEIGHT;
  const tempCtx = tempCanvas.getContext("2d");

  // Sample points and transform them
  const imageData = tempCtx.createImageData(TRANSFORM_WIDTH, TRANSFORM_HEIGHT);
  const data = imageData.data;

  // Create a temporary canvas to get video pixel data
  const videoCanvas = document.createElement("canvas");
  videoCanvas.width = video.videoWidth;
  videoCanvas.height = video.videoHeight;
  const videoCtx = videoCanvas.getContext("2d");
  videoCtx.drawImage(video, 0, 0);
  const videoImageData = videoCtx.getImageData(
    0,
    0,
    video.videoWidth,
    video.videoHeight
  );
  const videoData = videoImageData.data;

  // Transform each pixel
  for (let y = 0; y < TRANSFORM_HEIGHT; y++) {
    for (let x = 0; x < TRANSFORM_WIDTH; x++) {
      const transformedPoint = transformPoint(x, y, matrix);

      // Convert canvas coordinates to video coordinates
      const videoX = Math.round(
        ((transformedPoint.x - videoDisplayRect.x) / videoDisplayRect.width) *
          video.videoWidth
      );
      const videoY = Math.round(
        ((transformedPoint.y - videoDisplayRect.y) / videoDisplayRect.height) *
          video.videoHeight
      );

      // Check bounds
      if (
        videoX >= 0 &&
        videoX < video.videoWidth &&
        videoY >= 0 &&
        videoY < video.videoHeight
      ) {
        const sourceIndex = (videoY * video.videoWidth + videoX) * 4;
        const targetIndex = (y * TRANSFORM_WIDTH + x) * 4;

        data[targetIndex] = videoData[sourceIndex]; // R
        data[targetIndex + 1] = videoData[sourceIndex + 1]; // G
        data[targetIndex + 2] = videoData[sourceIndex + 2]; // B
        data[targetIndex + 3] = 255; // A
      }
    }
  }

  // Draw the transformed image
  tempCtx.putImageData(imageData, 0, 0);

  // Cache the transformed image
  if (!cachedTransformedImage) {
    cachedTransformedImage = document.createElement("canvas");
  }
  cachedTransformedImage.width = TRANSFORM_WIDTH;
  cachedTransformedImage.height = TRANSFORM_HEIGHT;
  const cacheCtx = cachedTransformedImage.getContext("2d");
  cacheCtx.drawImage(tempCanvas, 0, 0);

  // Draw to main canvas
  cropCtx.drawImage(tempCanvas, centerX, centerY);

  // Detect dots in the transformed image only when image actually changed
  if (dotDetectionEnabled) {
    detectedDots = detectDots(imageData);
    drawDotsOverlay();

    // Use debounced logging
    logDetectedDots();
  }
}

// Draw the video frame on the canvas
function drawVideoFrame() {
  if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate aspect ratios
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const canvasAspectRatio = canvas.width / canvas.height;

    // Variables to store the drawing dimensions
    let drawWidth,
      drawHeight,
      offsetX = 0,
      offsetY = 0;

    // Determine how to scale the video to maintain aspect ratio
    if (videoAspectRatio > canvasAspectRatio) {
      // Video is wider than canvas - constrain by width
      drawWidth = canvas.width;
      drawHeight = canvas.width / videoAspectRatio;
      offsetY = (canvas.height - drawHeight) / 2;
    } else {
      // Video is taller than canvas - constrain by height
      drawHeight = canvas.height;
      drawWidth = canvas.height * videoAspectRatio;
      offsetX = (canvas.width - drawWidth) / 2;
    }

    // Store the video display rectangle for constraining the corners
    videoDisplayRect = {
      x: offsetX,
      y: offsetY,
      width: drawWidth,
      height: drawHeight,
    };

    // If this is the first render or after resize, initialize/adjust the corners
    if (
      corners[0].x < videoDisplayRect.x ||
      corners[0].y < videoDisplayRect.y ||
      corners[1].x > videoDisplayRect.x + videoDisplayRect.width ||
      corners[1].y < videoDisplayRect.y ||
      corners[2].x > videoDisplayRect.x + videoDisplayRect.width ||
      corners[2].y > videoDisplayRect.y + videoDisplayRect.height ||
      corners[3].x < videoDisplayRect.x ||
      corners[3].y > videoDisplayRect.y + videoDisplayRect.height
    ) {
      // Reset rectangle to fit within video area
      const padding = Math.min(50, drawWidth / 10, drawHeight / 10);
      corners = [
        { x: offsetX + padding, y: offsetY + padding }, // top-left
        { x: offsetX + drawWidth - padding, y: offsetY + padding }, // top-right
        { x: offsetX + drawWidth - padding, y: offsetY + drawHeight - padding }, // bottom-right
        { x: offsetX + padding, y: offsetY + drawHeight - padding }, // bottom-left
      ];
    }

    // Draw the video with correct aspect ratio
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

    // Draw the rectangle overlay on top of the video
    drawRectangleOverlay();

    // Draw the transformed perspective view on the right canvas
    drawTransformedView();
  }

  // Continue the animation loop
  requestAnimationFrame(drawVideoFrame);
}

// Helper function to check if a point is inside a circle
function isPointInCircle(px, py, cx, cy, radius) {
  const distanceSquared = (px - cx) * (px - cx) + (py - cy) * (py - cy);
  return distanceSquared <= radius * radius;
}

// Find which corner was clicked (if any)
function findActiveCorner(x, y) {
  for (let i = 0; i < corners.length; i++) {
    if (isPointInCircle(x, y, corners[i].x, corners[i].y, cornerRadius)) {
      return i;
    }
  }
  return -1;
}

// Check if any corner is too close to the controls
function isCornerNearControls(corner) {
  const controls = document.getElementById("webcam-controls");
  if (!controls) return false;

  const rect = controls.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();

  // Convert control position to canvas coordinates
  const controlLeft = rect.left - canvasRect.left;
  const controlTop = rect.top - canvasRect.top;
  const controlRight = controlLeft + rect.width;
  const controlBottom = controlTop + rect.height;

  // Add a buffer zone around the controls
  const buffer = cornerRadius * 2;

  // Check if the corner is inside the control area plus buffer
  return (
    corner.x >= controlLeft - buffer &&
    corner.x <= controlRight + buffer &&
    corner.y >= controlTop - buffer &&
    corner.y <= controlBottom + buffer
  );
}

// Handle mouse/touch events
function setupInteraction() {
  // Mouse events
  canvas.addEventListener("mousedown", handleStart);
  canvas.addEventListener("mousemove", handleMove);
  canvas.addEventListener("mouseup", handleEnd);
  canvas.addEventListener("mouseout", handleEnd);

  // Touch events
  canvas.addEventListener("touchstart", handleStart);
  canvas.addEventListener("touchmove", handleMove);
  canvas.addEventListener("touchend", handleEnd);
  canvas.addEventListener("touchcancel", handleEnd);

  // The existing handleMove function can remain unchanged
  function handleMove(e) {
    e.preventDefault();

    if (activeCornerIndex === -1) return;

    const position = getEventPosition(e);
    const constrainedPosition = constrainPointToVideo(position);

    corners[activeCornerIndex].x = constrainedPosition.x;
    corners[activeCornerIndex].y = constrainedPosition.y;

    // Invalidate cache when corners change
    cachedTransformedImage = null;
    cornersChanged = true;

    // Reset motion detection when corners change
    lastVideoFrame = null;
  }

  function handleStart(e) {
    e.preventDefault();

    const position = getEventPosition(e);

    // First check if we're clicking on a corner
    activeCornerIndex = findActiveCorner(position.x, position.y);

    // If we found an active corner, check if it's near controls
    if (
      activeCornerIndex !== -1 &&
      isCornerNearControls(corners[activeCornerIndex])
    ) {
      // If the corner is near controls, temporarily hide controls during drag
      const controls = document.getElementById("webcam-controls");
      if (controls) {
        controls.style.opacity = "0.2";
      }
    }
  }

  function handleEnd(e) {
    e.preventDefault();

    // Restore controls visibility if needed
    const controls = document.getElementById("webcam-controls");
    if (controls && controls.style.opacity !== "1") {
      controls.style.opacity = "1";
    }

    activeCornerIndex = -1;
  }

  function getEventPosition(e) {
    let x, y;

    if (e.type.startsWith("touch")) {
      // Touch event
      const touch = e.touches[0] || e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      x = touch.clientX - rect.left;
      y = touch.clientY - rect.top;
    } else {
      // Mouse event
      x = e.offsetX;
      y = e.offsetY;
    }

    return { x, y };
  }
}

// Helper function to constrain a point within the video display area
function constrainPointToVideo(point) {
  return {
    x: Math.max(
      videoDisplayRect.x,
      Math.min(point.x, videoDisplayRect.x + videoDisplayRect.width)
    ),
    y: Math.max(
      videoDisplayRect.y,
      Math.min(point.y, videoDisplayRect.y + videoDisplayRect.height)
    ),
  };
}

// Initialize everything
async function init() {
  setupCanvas();
  const hasWebcams = await getAvailableWebcams();
  if (hasWebcams) {
    await setupWebcam();
    setupInteraction();
    drawVideoFrame();
  }

  initSocket();

  // Handle window resize
  window.addEventListener("resize", () => {
    setupCanvas();
    // Invalidate cache on resize
    cachedTransformedImage = null;
    lastVideoFrame = null;
    // Reset dot detection state
    lastDetectedDots = [];
    lastDotLogTime = 0;
  });

  // Add keyboard shortcut to toggle dot detection
  document.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") {
      dotDetectionEnabled = !dotDetectionEnabled;
      console.log(
        "Dot detection:",
        dotDetectionEnabled ? "enabled" : "disabled"
      );
      // Reset dot detection state when toggling
      if (dotDetectionEnabled) {
        lastDetectedDots = [];
        lastDotLogTime = 0;
      }
    }
    // Add shortcut to adjust motion sensitivity
    if (e.key === "m" || e.key === "M") {
      console.log("Motion detection threshold:", MOTION_THRESHOLD);
      console.log(
        "Current motion status:",
        lastVideoFrame ? "monitoring" : "initializing"
      );
    }
    // Add shortcut to force log current dots
    if (e.key === "l" || e.key === "L") {
      if (detectedDots.length > 0) {
        console.log(
          "Current dots (forced):",
          detectedDots.map((dot) => ({
            x: dot.x,
            y: dot.y,
            size: dot.size,
          }))
        );
      } else {
        console.log("No dots currently detected");
      }
    }
  });
}

// Start the application when the page loads
window.addEventListener("load", init);
