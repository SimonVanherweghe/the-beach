"""
Draw a wavy border around the safe region and render 'The beach' label.

Usage:
    python plotborder.py <width> <height> <margin> <text_margin>
        → draws wavy border + "The beach" label

    python plotborder.py --complete "<timestamp>" <width> <height> <margin> <text_margin>
        → draws " was full on <timestamp>" continuing from the end of "The beach"

All dimensions in mm.  The plotter works in landscape orientation:
  X = long edge (paper width), Y = short edge (paper height).

The user views the paper in portrait – the "bottom-left" of the portrait view
corresponds to (high-X, low-Y) in landscape.  Text is rotated 90° CW so it
reads naturally in portrait.

Paths are generated as polylines, optimised with vpype (linesort, linemerge,
linesimplify), then sent to the AxiDraw interactive API.
"""

import sys
import math
import random
import time

import numpy as np
import vpype
from vpype_cli import execute as vpype_execute

from pyaxidraw import axidraw
from HersheyFonts import HersheyFonts

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CHAR_HEIGHT_MM = 12         # cap-height for Hershey rendering (thick marker)
CHAR_HEIGHT_SMALL_MM = 8    # smaller cap-height for the completion text
WAVE_AMPLITUDE = 1.0        # mm – sine perturbation on each border side
WAVE_PERIOD = 30.0          # mm – wavelength of the sine border
STEP_MM = 2.0               # mm – resolution along each border side

# AxiDraw limits (same as plotdot.py)
MAX_TRAVEL_X = 430
MAX_TRAVEL_Y = 297

# ---------------------------------------------------------------------------
# Hershey font helper
# ---------------------------------------------------------------------------

_font = HersheyFonts()
_font.load_default_font("futural")
_font.normalize_rendering(CHAR_HEIGHT_MM)

_font_small = HersheyFonts()
_font_small.load_default_font("futural")
_font_small.normalize_rendering(CHAR_HEIGHT_SMALL_MM)


def _text_strokes(text, small=False):
    """Return list of strokes for *text*.  Each stroke is [(x,y), …]."""
    f = _font_small if small else _font
    return [list(s) for s in f.strokes_for_text(text)]


def _text_width(text, small=False):
    """Width (mm) of rendered text at current cap-height."""
    strokes = _text_strokes(text, small=small)
    xs = [pt[0] for s in strokes for pt in s]
    if not xs:
        return 0.0
    return max(xs) - min(xs)


# ---------------------------------------------------------------------------
# Path builders – return lists of polylines [[(x,y), …], …]
# ---------------------------------------------------------------------------

def _wavy_side(p_start, p_end, amplitude, seed_offset=0):
    """Generate wavy points along a straight line from p_start to p_end."""
    dx = p_end[0] - p_start[0]
    dy = p_end[1] - p_start[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return [p_start]

    tx, ty = dx / length, dy / length
    nx, ny = -ty, tx

    steps = max(2, int(length / STEP_MM))
    rng = random.Random(random.randint(0, 2**31) + seed_offset)
    phase = rng.uniform(0, 2 * math.pi)

    points = []
    for i in range(steps + 1):
        t = i / steps
        bx = p_start[0] + dx * t
        by = p_start[1] + dy * t
        wave = amplitude * math.sin(2 * math.pi * (t * length) / WAVE_PERIOD + phase)
        wave += amplitude * 0.3 * math.sin(2 * math.pi * (t * length) / (WAVE_PERIOD * 0.4) + phase * 1.7)
        points.append((bx + nx * wave, by + ny * wave))

    return points


def build_border_path(paper_w, paper_h, margin, text_margin):
    """Return a single polyline [(x,y), …] for the wavy border rectangle."""
    border_offset = 1.0
    left = margin - border_offset
    right = paper_w - text_margin + border_offset
    top = margin - border_offset
    bottom = paper_h - margin + border_offset

    corners = [
        (left, top), (right, top),
        (right, bottom), (left, bottom),
    ]

    full_path = []
    for i in range(4):
        p_start = corners[i]
        p_end = corners[(i + 1) % 4]
        side_pts = _wavy_side(p_start, p_end, WAVE_AMPLITUDE, seed_offset=i * 7)
        if full_path:
            side_pts = side_pts[1:]
        full_path.extend(side_pts)

    # Close the loop
    if full_path:
        full_path.append(full_path[0])

    return full_path


def _rotated_text_strokes(text, landscape_x, landscape_y_start, small=False):
    """Return polylines for *text* rotated for portrait reading.

    Physical setup: paper is landscape on the plotter (X right, Y away),
    then rotated 90° CW to portrait.  In portrait the viewer sees:
      portrait left  = high landscape-Y
      portrait right = low  landscape-Y
      portrait up    = low  landscape-X
      portrait down  = high landscape-X

    Mapping glyph coords (gx = char advance rightward, gy = upward):
      landscape_x = base_x - gy   (glyph up → portrait up → lower X)
      landscape_y = base_y - gx   (glyph right → portrait right → lower Y)

    *landscape_y_start* is the high-Y starting position (portrait left edge).
    Returns (polylines, y_end) where y_end is the landscape-Y after the text.
    """
    strokes = _text_strokes(text, small=small)
    if not strokes:
        return [], landscape_y_start

    all_gx = [pt[0] for s in strokes for pt in s]
    glyph_x_max = max(all_gx) if all_gx else 0

    polylines = []
    for stroke in strokes:
        if len(stroke) < 2:
            continue
        line = []
        for gx, gy in stroke:
            lx = landscape_x - gy
            ly = landscape_y_start - gx
            line.append((lx, ly))
        polylines.append(line)

    return polylines, landscape_y_start - glyph_x_max


def build_label_paths(paper_w, paper_h, margin, text_margin):
    """Return (polylines, y_end) for "The beach" label."""
    strip_center_x = paper_w - text_margin / 2
    landscape_x = strip_center_x + CHAR_HEIGHT_MM / 2
    # Start at high landscape-Y (= portrait left), with padding from border
    landscape_y_start = paper_h - margin - 2
    return _rotated_text_strokes("The beach", landscape_x, landscape_y_start)


def build_completion_paths(timestamp, paper_w, paper_h, margin, text_margin):
    """Return polylines for ' was full on <timestamp>' continuation text."""
    strip_center_x = paper_w - text_margin / 2
    landscape_x = strip_center_x + CHAR_HEIGHT_SMALL_MM / 2
    y_continuation = _compute_label_end_y(paper_h, margin)
    completion = f" was full on {timestamp}"
    polylines, _ = _rotated_text_strokes(completion, landscape_x, y_continuation, small=True)
    return polylines


def _compute_label_end_y(paper_h, margin):
    """Compute the landscape Y where 'The beach' label ends (without drawing)."""
    landscape_y_start = paper_h - margin - 2
    label_width = _text_width("The beach")
    return landscape_y_start - label_width


# ---------------------------------------------------------------------------
# vpype optimisation
# ---------------------------------------------------------------------------

# vpype works in CSS pixels (96 dpi).  1 mm = 96/25.4 px ≈ 3.7795 px
MM_TO_PX = 96.0 / 25.4


def _polylines_to_vpype_doc(polylines):
    """Convert a list of polylines [[(x_mm, y_mm), …], …] to a vpype Document."""
    doc = vpype.Document()
    lc = vpype.LineCollection()
    for pl in polylines:
        if len(pl) < 2:
            continue
        points = np.array([complex(x * MM_TO_PX, y * MM_TO_PX) for x, y in pl])
        lc.append(points)
    if len(lc) > 0:
        doc.add(lc, 1)
    return doc


def _vpype_doc_to_polylines_mm(doc):
    """Extract polylines in mm from an optimised vpype Document."""
    polylines = []
    for layer_id in sorted(doc.layers.keys()):
        for line in doc.layers[layer_id]:
            pts = [(p.real / MM_TO_PX, p.imag / MM_TO_PX) for p in line]
            if len(pts) >= 2:
                polylines.append(pts)
    return polylines


def optimise_paths(polylines):
    """Run vpype linesort + linemerge + linesimplify on a set of polylines."""
    doc = _polylines_to_vpype_doc(polylines)
    if not doc.layers:
        return polylines
    doc = vpype_execute("linesort linemerge linesimplify -t 0.1mm", doc)
    return _vpype_doc_to_polylines_mm(doc)


# ---------------------------------------------------------------------------
# Plotter execution
# ---------------------------------------------------------------------------

def plot_polylines(ad, polylines):
    """Send a list of polylines to the AxiDraw (moveto first point, lineto rest)."""
    for pl in polylines:
        if len(pl) < 2:
            continue
        ad.moveto(pl[0][0], pl[0][1])
        for x, y in pl[1:]:
            ad.lineto(x, y)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]

    complete_mode = False
    timestamp = None

    if args and args[0] == "--complete":
        complete_mode = True
        if len(args) < 6:
            print("Usage: plotborder.py --complete <timestamp> <width> <height> <margin> <text_margin>")
            sys.exit(1)
        timestamp = args[1]
        args = args[2:]
    elif len(args) < 4:
        print("Usage: plotborder.py <width> <height> <margin> <text_margin>")
        print("       plotborder.py --complete <timestamp> <width> <height> <margin> <text_margin>")
        sys.exit(1)

    paper_w = float(args[0])
    paper_h = float(args[1])
    margin = float(args[2])
    text_margin = float(args[3])

    if paper_w > MAX_TRAVEL_X or paper_h > MAX_TRAVEL_Y:
        print(f"Warning: paper {paper_w}x{paper_h} exceeds plotter travel "
              f"{MAX_TRAVEL_X}x{MAX_TRAVEL_Y}", flush=True)

    # Build paths
    all_polylines = []

    if complete_mode:
        print(f"Building completion text: ' was full on {timestamp}'", flush=True)
        all_polylines = build_completion_paths(timestamp, paper_w, paper_h, margin, text_margin)
    else:
        print("Building wavy border...", flush=True)
        border = build_border_path(paper_w, paper_h, margin, text_margin)
        all_polylines.append(border)
        print("Building 'The beach' label...", flush=True)
        label_paths, _ = build_label_paths(paper_w, paper_h, margin, text_margin)
        all_polylines.extend(label_paths)

    # Optimise with vpype
    print(f"Optimising {len(all_polylines)} path(s) with vpype...", flush=True)
    optimised = optimise_paths(all_polylines)
    print(f"Optimised to {len(optimised)} path(s).", flush=True)

    # Connect to AxiDraw and plot
    ad = axidraw.AxiDraw()
    ad.interactive()
    ad.options.units = 2
    ad.options.model = 2
    ad.options.penlift = 3
    ad.connect()
    ad.update()

    try:
        print("Plotting...", flush=True)
        plot_polylines(ad, optimised)
        ad.moveto(0, 0)
        print("Done.", flush=True)
    finally:
        ad.disconnect()


if __name__ == "__main__":
    main()
